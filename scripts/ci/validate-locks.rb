#!/usr/bin/env ruby
# Parse on the same macOS Ruby/Bundler that resolved the candidates. Never print values.
require 'yaml'
require 'uri'

# Second mode: semantic Podfile.lock <-> Pods/Manifest.lock equality check.
# install-pods.sh stamps Manifest.lock with Podfile.lock only to defeat the
# byte-level format drift that pod install --deployment leaves behind; the stamp
# is allowed solely when the already-installed manifest resolves to the SAME
# dependency graph — this check proves that before the copy runs, so the stamp
# can never paper over a genuinely different resolution, source or checksum.
# Compares only resolved-dependency fields; COCOAPODS version is included.
if ARGV[0] == 'manifest-compare'
  begin
    left, right = ARGV.fetch(1), ARGV.fetch(2)
    option_keys = [:path, :podspec, :git, :http, :commit, :tag, :branch, :sha256].freeze
    parse = lambda do |file|
      text = File.read(file)
      raise unless text.ascii_only? && !text.include?("\0") && text.bytesize < 2_000_000
      YAML.safe_load(text, permitted_classes: [Symbol], permitted_symbols: option_keys, aliases: false)
    end
    l, r = parse.call(left), parse.call(right)
    raise unless l.is_a?(Hash) && r.is_a?(Hash)
    raise unless l == r
    puts 'POD_MANIFEST_MATCH'
  rescue Exception
    warn 'POD_MANIFEST_DRIFT'
    exit 1
  else
    exit 0
  end
end

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
  raise unless gem_text.lines.all? { |line| line.match?(/\A(?:\n|GEM\n|PLATFORMS\n|DEPENDENCIES\n|RUBY VERSION\n|BUNDLED WITH\n|CHECKSUMS\n|  remote: https:\/\/rubygems\.org\/\n|  specs:\n| {2,6}[A-Za-z0-9_.+*!=<>()~ ,\-]+\n)\z/) }
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
  phase = 'GEM_CHECKSUMS'
  # Every resolved gem spec MUST carry exactly one sha256 checksum bound in the
  # lock — gem bytes are executed before final verification, so the reviewed
  # lock hash must commit to gem content, not just names/versions. A lock with
  # a missing section, unpaired entries, malformed digests or duplicate names
  # fails closed here, before any installation.
  store = gems.sources.first.checksum_store.instance_variable_get(:@store)
  raise unless store.is_a?(Hash) && !store.empty?
  checksum_lines = gem_text.scan(/^  ([A-Za-z0-9_.\-]+) \(([^)]+)\) sha256=([0-9a-f]{64})$/).map { |n, v, d| [n, v, d] }
  raise unless checksum_lines.length == store.size
  # Keys are name (version[-platform]) exactly as the CHECKSUMS section spells
  # them — platform-specific variants are distinct artifact bindings.
  spec_keys = gems.specs.map { |spec| "#{spec.name} (#{spec.full_name.sub(/\A#{Regexp.escape(spec.name)}-/, '')})" }
  raise unless checksum_lines.map { |n, v, _| "#{n} (#{v})" }.sort == spec_keys.sort
  checksum_lines.each do |n, v, d|
    key = "#{n} (#{v})"
    entry = store[key]
    raise unless entry.is_a?(Hash) && entry['sha256']
    raise unless entry['sha256'].to_lock == "sha256=#{d}"
  end
  phase = 'GEM_ROUNDTRIP'
  safe_gems = gems.sources.first.to_lock
  gems.specs.sort_by(&:full_name).each { |s| safe_gems << s.to_lock }
  safe_gems << "\nPLATFORMS\n"
  gems.platforms.map(&:to_s).sort.each { |p| safe_gems << "  #{p}\n" }
  safe_gems << "\nDEPENDENCIES\n"
  gems.dependencies.sort.each { |_, dep| safe_gems << "#{dep.to_lock}\n" }
  safe_gems << "\nRUBY VERSION\n   #{gems.ruby_version}\n\nBUNDLED WITH\n   2.6.9\n"
  safe_gems << "\nCHECKSUMS\n"
  checksum_lines.sort.each { |n, v, d| safe_gems << "  #{n} (#{v}) sha256=#{d}\n" }
  reparsed = Bundler::LockfileParser.new(safe_gems)
  raise unless reparsed.specs.map(&:full_name) == gems.specs.map(&:full_name) && reparsed.dependencies.keys.sort == gems.dependencies.keys.sort
  reparsed_store = reparsed.sources.first.checksum_store.instance_variable_get(:@store)
  raise unless reparsed_store.keys.sort == store.keys.sort
  phase = 'POD_FORMAT'
  pod_text = File.read(File.join(root, 'Podfile.lock'))
  raise unless pod_text.ascii_only? && !pod_text.include?("\0") && pod_text.bytesize < 2_000_000
  phase = 'POD_PARSE'
  # CocoaPods 1.16.2 emits Symbol keys such as :path and :podspec. Permit
  # only its finite source-option vocabulary; never allow arbitrary Ruby classes
  # or symbols. Keep symbols intact so pod install --deployment sees the same
  # external_source hashes as the original lock, including after serialization.
  option_keys = [:path, :podspec, :git, :http, :commit, :tag, :branch, :sha256].freeze
  parse_pods = lambda do |text|
    YAML.safe_load(text, permitted_classes: [Symbol], permitted_symbols: option_keys, aliases: false)
  end
  pods = parse_pods.call(pod_text)
  phase = 'POD_STRUCTURE_ROOT'
  raise unless pods.is_a?(Hash)
  phase = 'POD_STRUCTURE_KEYS'
  allowed = ['PODS', 'DEPENDENCIES', 'SPEC REPOS', 'EXTERNAL SOURCES', 'CHECKOUT OPTIONS', 'SPEC CHECKSUMS', 'PODFILE CHECKSUM', 'COCOAPODS']
  raise unless (pods.keys - allowed).empty?
  phase = 'POD_STRUCTURE_VERSION'
  raise unless pods['COCOAPODS'] == '1.16.2'
  token = /\A[A-Za-z0-9_.+\/() ,=<>!~\-]+\z/
  # RN 0.88.1 prebuilt helpers install dependency-only facades at these exact
  # relative paths. Bind each path to its real root pod; do not allow build/**.
  # The test calls both locked RN helper modules to verify this finite mapping.
  facade_paths = {}
  ['FBLazyVector', 'RCTDeprecation', 'RCTRequired', 'React-Core', 'React-RCTFabric', 'React-RCTRuntime', 'Yoga'].each do |name|
    facade_paths[name] = "build/rncore-facades/#{name}"
  end
  ['DoubleConversion', 'RCT-Folly', 'SocketRocket', 'boost', 'fast_float', 'fmt', 'glog'].each do |name|
    facade_paths[name] = "build/rndeps-facades/#{name}"
  end
  facade_paths.freeze
  # First-party M5 source module, not a general ../modules allowance. Bind the
  # exact pod identity and directory; traversal/children/other modules reject.
  first_party_paths = { 'PiGuiRemote' => '../modules/pi-gui-remote/ios' }.freeze
  local_path = lambda do |value, pod_name = nil|
    next false if value.delete_prefix('../').split('/').include?('..')
    value.match?(%r{\A(?:\.\./node_modules/[A-Za-z0-9_@./+\-]+|build/generated/ios(?:/[A-Za-z0-9_./+\-]+)?)\z}) ||
      (pod_name.is_a?(String) && (facade_paths[pod_name.split('/').first] == value ||
        first_party_paths[pod_name.split('/').first] == value))
  end
  visit = lambda do |value|
    case value
    when Array then value.each { |v| visit.call(v) }
    when Hash
      value.each do |k, v|
        phase = 'POD_ENTRY_KEY'
        raise unless k.is_a?(String) && k.match?(token)
        visit.call(v)
      end
    when String
      unless value.match?(token)
        phase = 'POD_ENTRY_REFERENCE'
        from = value.match(/\A([A-Za-z0-9_.+\/\-]+) \(from [`'\"]([^`'\"]+)[`'\"]\)\z/)
        raise unless from
        phase = 'POD_ENTRY_LOCAL_PATH'
        raise unless local_path.call(from[2], from[1])
      end
    else
      phase = 'POD_ENTRY_TYPE'
      raise
    end
  end
  ['PODS', 'DEPENDENCIES'].each do |key|
    phase = 'POD_DEPENDENCY_ARRAY'
    raise unless pods[key].is_a?(Array)
    visit.call(pods[key])
  end
  phase = 'POD_REPOSITORIES'
  repos = pods.fetch('SPEC REPOS', {})
  raise unless repos.is_a?(Hash) && (repos.keys - ['trunk', 'https://cdn.cocoapods.org/']).empty?
  repos.values.each { |v| visit.call(v) }
  phase = 'POD_SOURCES'
  hosts = ['github.com', 'cdn.cocoapods.org', 'repo1.maven.org', 'repo.maven.apache.org', 'repo.reactnative.dev']
  ['EXTERNAL SOURCES', 'CHECKOUT OPTIONS'].each do |section|
    pods.fetch(section, {}).each do |name, options|
      raise unless name.is_a?(String) && name.match?(token) && options.is_a?(Hash)
      options.each do |key, value|
        raise unless value.is_a?(String)
        case key
        when :path
          raise unless local_path.call(value, name)
        when :podspec
          raise unless local_path.call(value)
        when :git, :http
          uri = URI.parse(value)
          raise unless uri.scheme == 'https' && hosts.include?(uri.host) && !uri.userinfo && !uri.query && !uri.fragment && uri.port == 443
          raise unless uri.path.match?(%r{\A/[A-Za-z0-9_./+\-]+\z})
        when :commit, :tag, :branch, :sha256
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
  checksums.each { |name, digest| raise unless name.is_a?(String) && name.match?(token) && digest.is_a?(String) && digest.match?(/\A[0-9a-f]{40}\z/) }
  # Disallow YAML comments, directives, extra documents or unused scalar material.
  # Re-parse a round trip to prove the semantic representation is stable; publish
  # YAML.dump, so no unparsed comments or input spelling can become an artifact.
  phase = 'SERIALIZE'
  safe_pods = YAML.dump(pods)
  raise unless parse_pods.call(safe_pods) == pods
  # Binary mode: canonical bytes must be platform-independent — Windows text
  # mode would emit CRLF, macOS LF, and the reviewed hash binds exact bytes.
  File.binwrite(File.join(root, 'Podfile.lock'), safe_pods)
  File.binwrite(File.join(root, 'Gemfile.lock'), safe_gems)
  puts 'NATIVE_LOCKS_SAFE'
rescue Exception
  warn "NATIVE_LOCKS_REJECTED_#{phase}"
  exit 1
end
