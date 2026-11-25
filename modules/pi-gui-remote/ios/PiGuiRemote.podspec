Pod::Spec.new do |s|
  s.name = 'PiGuiRemote'
  s.version = '0.0.1'
  s.summary = 'Private remote-v1 pinned transport'
  s.description = 'First-party, default-off pinned HTTPS/SSE and native Keychain signing.'
  s.license = { :type => 'Proprietary' }
  s.author = 'Pi GUI Mobile contributors'
  s.homepage = 'https://github.com/HYJ1817/pi-gui-ios'
  s.source = { :git => 'https://github.com/HYJ1817/pi-gui-ios.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Foundation', 'Network', 'Security', 'CryptoKit'
  s.source_files = '**/*.swift'
end
