#!/usr/bin/env ruby
# Parse on the same macOS Ruby/Bundler that resolved the candidates. Never print values.
require 'yaml'
require 'uri'
phase = 'GEM_RUNTIME'
begin
  gem 'bundler', '= 2.6.9'
  require 'bundler'
  root = ARGV.fetch(0)
  phase = 'GEM_FORMAT'
  gem_text = File.read(File.join(root, 'Gemfile.lock'))
  raise unless gem_text.ascii_only? && gem_text.bytesize < 2_000_000
  # A parsed lock alone can ignore trailing comments: reject non-lock syntax and
  # reconstruct only parsed fields below, rather than copying the input verbatim.
  raise unless gem_text.lines.all? { |line| line.match?(/\A(?:\n|GEM\n|PLATFORMS\n|DEPENDENCIES\n|RUBY VERSION\n|BUNDLED WITH\n|  remote: https:\/\/rubygems\.org\/\n|  specs:\n| {2,6}[A-Za-z0-9_.+*!=<>()~ ,\-]+\n)\z/) }
  phase = 'GEM_PARSE'
  gems = Bundler::LockfileParser.new(gem_text)
  phase = 'GEM_CONSTRAINTS'
  raise unless gems.sources.all? { |s| s.is_a?(Bundler::Source::Rubygems) && s.remotes.map(&:to_s) == ['https://rubygems.org/'] }
  raise unless gems.bundler_version.to_s == '2.6.9'
  raise unless gems.specs.any? { |s| s.name == 'cocoapods' && s.version.to_s == '1.16.2' }
  raise unless gems.sources.length == 1 && gems.dependencies.keys.sort == ['bundler', 'cocoapods']
  raise unless gems.dependencies['bundler'].requirement.to_s == '= 2.6.9' && gems.dependencies['cocoapods'].requirement.to_s == '= 1.16.2'
  raise unless gems.ruby_version.match?(/\Aruby 3\.3\.8p[0-9]+\z/)
  raise unless gems.specs.all? { |s| s.name.match?(/\A[A-Za-z0-9_.\-]+\z/) }
  raise unless gems.platforms.all? { |p| p.to_s.match?(/\A[A-Za-z0-9_.\-]+\z/) }
  phase = 'GEM_ROUNDTRIP'
  safe_gems = gems.sources.first.to_lock
  gems.specs.sort_by(&:full_name).each { |s| safe_gems << s.to_lock }
  safe_gems << "\nPLATFORMS\n"
  gems.platforms.map(&:to_s).sort.each { |p| safe_gems << "  #{p}\n" }
  safe_gems << "\nDEPENDENCIES\n"
  gems.dependencies.sort.each { |_, dep| safe_gems << "#{dep.to_lock}\n" }
  safe_gems << "\nRUBY VERSION\n   #{gems.ruby_version}\n\nBUNDLED WITH\n   2.6.9\n"
  reparsed = Bundler::LockfileParser.new(safe_gems)
  raise unless reparsed.specs.map(&:full_name) == gems.specs.map(&:full_name) && reparsed.dependencies.keys.sort == gems.dependencies.keys.sort
  phase = 'POD_FORMAT'
  pod_text = File.read(File.join(root, 'Podfile.lock'))
  raise unless pod_text.ascii_only? && !pod_text.include?("\0") && pod_text.bytesize < 2_000_000
  pods = YAML.safe_load(pod_text, permitted_classes: [], permitted_symbols: [], aliases: false)
  phase = 'POD_STRUCTURE'
  allowed = ['PODS', 'DEPENDENCIES', 'SPEC REPOS', 'EXTERNAL SOURCES', 'CHECKOUT OPTIONS', 'SPEC CHECKSUMS', 'PODFILE CHECKSUM', 'COCOAPODS']
  raise unless pods.is_a?(Hash) && (pods.keys - allowed).empty? && pods['COCOAPODS'] == '1.16.2'
  token = /\A[A-Za-z0-9_.+\/() ,=<>!~\-]+\z/
  local_path = lambda do |value|
    value.match?(%r{\A(?:\.\./node_modules/[A-Za-z0-9_@./+\-]+|build/generated/ios(?:/[A-Za-z0-9_./+\-]+)?)\z}) && !value.delete_prefix('../').split('/').include?('..')
  end
  visit = lambda do |value|
    case value
    when Array then value.each { |v| visit.call(v) }
    when Hash then value.each { |k, v| raise unless k.is_a?(String) && k.match?(token); visit.call(v) }
    when String
      unless value.match?(token)
        from = value.match(/\A[A-Za-z0-9_.+\/\-]+ \(from [`'\"]([^`'\"]+)[`'\"]\)\z/)
        raise unless from && local_path.call(from[1])
      end
    else raise
    end
  end
  ['PODS', 'DEPENDENCIES'].each { |key| raise unless pods[key].is_a?(Array); visit.call(pods[key]) }
  repos = pods.fetch('SPEC REPOS', {})
  raise unless repos.is_a?(Hash) && (repos.keys - ['trunk', 'https://cdn.cocoapods.org/']).empty?
  repos.values.each { |v| visit.call(v) }
  phase = 'POD_SOURCES'
  hosts = ['github.com', 'cdn.cocoapods.org', 'repo1.maven.org', 'repo.maven.apache.org', 'repo.reactnative.dev']
  ['EXTERNAL SOURCES', 'CHECKOUT OPTIONS'].each do |section|
    pods.fetch(section, {}).each do |name, options|
      raise unless name.match?(token) && options.is_a?(Hash)
      options.each do |key, value|
        raise unless value.is_a?(String)
        case key
        when ':path', ':podspec'
          raise unless local_path.call(value)
        when ':git', ':http'
          uri = URI.parse(value)
          raise unless uri.scheme == 'https' && hosts.include?(uri.host) && !uri.userinfo && !uri.query && !uri.fragment && uri.port == 443
          raise unless uri.path.match?(%r{\A/[A-Za-z0-9_./+\-]+\z})
        when ':commit', ':tag', ':branch', ':sha256'
          raise unless value.match?(/\A[A-Za-z0-9_.+\-]+\z/)
        else raise
        end
      end
    end
  end
  phase = 'POD_CHECKSUMS'
  raise unless pods['PODFILE CHECKSUM'].is_a?(String) && pods['PODFILE CHECKSUM'].match?(/\A[0-9a-f]{40}\z/)
  checksums = pods.fetch('SPEC CHECKSUMS')
  raise unless checksums.is_a?(Hash) && !checksums.empty?
  checksums.each { |name, digest| raise unless name.match?(token) && digest.is_a?(String) && digest.match?(/\A[0-9a-f]{40}\z/) }
  # Disallow YAML comments, directives, extra documents or unused scalar material.
  # Re-parse a round trip to prove the semantic representation is stable; publish
  # YAML.dump, so no unparsed comments or input spelling can become an artifact.
  phase = 'SERIALIZE'
  safe_pods = YAML.dump(pods)
  raise unless YAML.safe_load(safe_pods, aliases: false) == pods
  File.write(File.join(root, 'Podfile.lock'), safe_pods)
  File.write(File.join(root, 'Gemfile.lock'), safe_gems)
  puts 'NATIVE_LOCKS_SAFE'
rescue Exception
  warn "NATIVE_LOCKS_REJECTED_#{phase}"
  exit 1
end
