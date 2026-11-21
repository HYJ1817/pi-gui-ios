#!/usr/bin/env python3
"""Fail-closed, stdlib-only inspection of directory AND final ZIP bytes.

This is an archive policy check, not a signature, loader, or SideStore install test.
Diagnostics intentionally contain fixed codes only (never plist values or paths).
"""
import json
import os
import pathlib
import plistlib
import re
import stat
import struct
import sys
import zipfile


class Invalid(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Invalid(code)


MAGICS = {b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xce\xfa\xed\xfe',
          b'\xfe\xed\xfa\xce', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca',
          b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}
ARM64 = 0x100000C
MAX_FILE = 512 * 1024 * 1024
MAX_ARCHIVE = 2 * 1024 * 1024 * 1024
BUNDLE_ID = 'io.github.hyj1817.piguimobile'
# No sensitive permission has been approved for the offline M-1 probe.
PERMISSIONS = {}
ATS = {key: False for key in ('NSAllowsArbitraryLoads', 'NSAllowsLocalNetworking',
       'NSAllowsArbitraryLoadsInWebContent', 'NSAllowsArbitraryLoadsForMedia')}
BENIGN_NS = {'NSHumanReadableCopyright', 'NSPrincipalClass', 'NSMainNibFile',
             'NSHighResolutionCapable'}
BENIGN_LS = {'LSRequiresIPhoneOS', 'LSMinimumSystemVersion', 'LSApplicationCategoryType'}
BENIGN_UI = {'UIDeviceFamily', 'UILaunchStoryboardName', 'UIMainStoryboardFile',
             'UIRequiredDeviceCapabilities', 'UIRequiresFullScreen', 'UIStatusBarStyle',
             'UIStatusBarHidden', 'UIUserInterfaceStyle', 'UIAppFonts',
             'UIViewControllerBasedStatusBarAppearance', 'UIWhitePointAdaptivityStyle',
             'UISupportedInterfaceOrientations', 'UISupportedInterfaceOrientations~ipad',
             'UIApplicationSupportsIndirectInputEvents', 'UILaunchScreen'}
DENIED_KEYS = {'CFBundleDocumentTypes', 'UTExportedTypeDeclarations', 'UTImportedTypeDeclarations',
               'UIBackgroundModes', 'NSExtension', 'LSEnvironment', 'SMPrivilegedExecutables',
               'WKAppBoundDomains', 'Entitlements', 'get-task-allow', 'aps-environment',
               'beta-reports-active', 'inter-app-audio', 'CFBundleResourceSpecification',
               'BGTaskSchedulerPermittedIdentifiers'}
FALSE_KEYS = {'UIFileSharingEnabled', 'LSSupportsOpeningDocumentsInPlace', 'LSUIElement',
              'LSBackgroundOnly'}


def checked_filesystem_path(value, root=None):
    """Reject links/reparse points in every ancestor and canonical tree escapes."""
    path = pathlib.Path(os.path.abspath(value))
    inspect = list(reversed([path, *path.parents]))
    current = None
    for item in inspect:
        current = item.lstat()
        require(not stat.S_ISLNK(current.st_mode) and not
                (getattr(current, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)),
                'ARCHIVE_LINK')
    if root is not None:
        require(path.resolve(strict=True).is_relative_to(pathlib.Path(root).resolve(strict=True)), 'ARCHIVE_PATH')
    return current


def version(value):
    require(isinstance(value, str) and re.fullmatch(r'(?:[1-9][0-9]?)(?:\.[0-9]{1,2}){0,2}', value),
            'MINIMUM_OS_INVALID')
    parts = tuple(int(p) for p in value.split('.'))
    parts += (0,) * (3 - len(parts))
    require(12 <= parts[0] <= 99, 'MINIMUM_OS_INVALID')
    return parts


def packed_version(value):
    result = (value >> 16, (value >> 8) & 255, value & 255)
    require(12 <= result[0] <= 99 and result[1] <= 99 and result[2] <= 99,
            'MACHO_VERSION_INVALID')
    return result


def macho(data, allow_signature=False):
    """Parse fat headers, 64-bit headers and load commands; never invoke lipo."""
    require(len(data) >= 4, 'MACHO_TRUNCATED')
    magic = data[:4]
    fats = {b'\xca\xfe\xba\xbe': ('>', False), b'\xbe\xba\xfe\xca': ('<', False),
            b'\xca\xfe\xba\xbf': ('>', True), b'\xbf\xba\xfe\xca': ('<', True)}
    if magic in fats:
        endian, wide = fats[magic]
        require(len(data) >= 8, 'MACHO_FAT_TRUNCATED')
        count, = struct.unpack_from(endian + 'I', data, 4)
        require(count == 1, 'MACHO_ARCHITECTURES')
        size = 32 if wide else 20
        require(len(data) >= 8 + size, 'MACHO_FAT_TRUNCATED')
        fields = struct.unpack_from(endian + ('IIQQII' if wide else 'IIIII'), data, 8)
        cpu, subtype, offset, length, align = fields[:5]
        require(cpu == ARM64 and subtype == 0, 'MACHO_ARCHITECTURES')
        require(align <= 30 and offset % (1 << align) == 0 and offset >= 8 + size
                and length > 0 and offset + length == len(data), 'MACHO_FAT_BOUNDS')
        if wide:
            require(fields[5] == 0, 'MACHO_FAT_BOUNDS')
        require(data[offset:offset + 4] not in fats, 'MACHO_NESTED_FAT')
        return macho(data[offset:offset + length], allow_signature)
    require(magic == b'\xcf\xfa\xed\xfe' and len(data) >= 32, 'MACHO_NOT_ARM64')
    _, cpu, subtype, filetype, count, command_bytes, _, reserved = struct.unpack_from('<8I', data)
    require(cpu == ARM64 and subtype == 0, 'MACHO_ARCHITECTURES')
    require(filetype in (2, 6, 8) and reserved == 0, 'MACHO_FILETYPE')
    end = 32 + command_bytes
    require(0 < count <= 65535 and command_bytes <= len(data) - 32, 'MACHO_COMMAND_BOUNDS')
    offset, build, text, signed = 32, None, False, False
    for _ in range(count):
        require(offset + 8 <= end, 'MACHO_COMMAND_BOUNDS')
        command, length = struct.unpack_from('<II', data, offset)
        require(length >= 8 and length % 8 == 0 and offset + length <= end, 'MACHO_COMMAND_BOUNDS')
        if command == 0x32:  # LC_BUILD_VERSION
            require(build is None and length >= 24, 'MACHO_BUILD_VERSION')
            platform, minimum, sdk, tools = struct.unpack_from('<4I', data, offset + 8)
            require(platform == 2, 'MACHO_NOT_IOS_DEVICE')  # PLATFORM_IOS, NOT 7 (simulator)
            require(length == 24 + 8 * tools, 'MACHO_BUILD_VERSION')
            build = packed_version(minimum)
            require(packed_version(sdk) >= build, 'MACHO_SDK_VERSION')
        elif command in (0x24, 0x25, 0x2F, 0x30):
            # Legacy-only metadata cannot establish the required modern platform policy.
            raise Invalid('MACHO_LEGACY_PLATFORM')
        elif command in (0x1D, 0x2B):  # LC_CODE_SIGNATURE / LC_DYLIB_CODE_SIGN_DRS
            require(length == 16, 'MACHO_SIGNATURE_BOUNDS')
            start, size = struct.unpack_from('<II', data, offset + 8)
            require(start <= len(data) and size <= len(data) - start, 'MACHO_SIGNATURE_BOUNDS')
            signed = True
        elif command == 0x19:  # LC_SEGMENT_64
            require(length >= 72, 'MACHO_SEGMENT_BOUNDS')
            name, _, memory_size, start, size, maximum, initial, sections, _ = struct.unpack_from(
                '<16sQQQQIIII', data, offset + 8)
            require(length == 72 + 80 * sections and start <= len(data)
                    and size <= len(data) - start and memory_size >= size,
                    'MACHO_SEGMENT_BOUNDS')
            require(initial & ~maximum == 0, 'MACHO_SEGMENT_BOUNDS')
            if name.rstrip(b'\0') == b'__TEXT' and size > 0 and initial & 4:
                text = True
        elif command == 0x2C:  # LC_ENCRYPTION_INFO_64
            require(length == 24, 'MACHO_ENCRYPTION')
            require(struct.unpack_from('<I', data, offset + 16)[0] == 0, 'MACHO_ENCRYPTION')
        elif command == 0x27:  # LC_DYLD_ENVIRONMENT
            raise Invalid('MACHO_DYLD_ENVIRONMENT')
        offset += length
    require(offset == end and build is not None and text, 'MACHO_BUILD_VERSION')
    require(allow_signature or not signed, 'MACHO_SIGNED')
    return {'minimum': build, 'filetype': filetype, 'signed': signed}


def plist_policy(value, allow_template_scene=False):
    if isinstance(value, dict):
        for key, item in value.items():
            require(isinstance(key, str), 'PLIST_KEY_INVALID')
            if key == 'UIApplicationSceneManifest':
                require(isinstance(item, dict) and set(item) == {'UIApplicationSupportsMultipleScenes', 'UISceneConfigurations'}
                        and item['UIApplicationSupportsMultipleScenes'] is False, 'PLIST_SCENE_CONFIGURATION')
                configurations = item['UISceneConfigurations']
                require(isinstance(configurations, dict) and set(configurations) == {'UIWindowSceneSessionRoleApplication'}, 'PLIST_SCENE_CONFIGURATION')
                scenes = configurations['UIWindowSceneSessionRoleApplication']
                require(isinstance(scenes, list) and len(scenes) == 1 and isinstance(scenes[0], dict)
                        and set(scenes[0]) == {'UISceneConfigurationName', 'UISceneDelegateClassName'}
                        and scenes[0]['UISceneConfigurationName'] == 'Default Configuration'
                        and scenes[0]['UISceneDelegateClassName'] in (('PiGUIMobile.SceneDelegate', '$(PRODUCT_MODULE_NAME).SceneDelegate') if allow_template_scene else ('PiGUIMobile.SceneDelegate',)),
                        'PLIST_SCENE_CONFIGURATION')
                continue
            if key == 'NSAppTransportSecurity':
                require(isinstance(item, dict), 'ATS_POLICY')
                for ats_key, ats_value in item.items():
                    require((ats_key in ATS and ats_value is ATS[ats_key]) or
                            (ats_key == 'NSExceptionDomains' and ats_value == {}), 'ATS_POLICY')
                continue
            require(key not in DENIED_KEYS and not key.startswith(('com.apple.',
                    'keychain-', 'application-identifier')), 'PLIST_SENSITIVE_KEY')
            if key in FALSE_KEYS:
                require(item is False, 'PLIST_SENSITIVE_KEY')
            elif key == 'LSApplicationQueriesSchemes':
                require(item == [], 'PLIST_SENSITIVE_KEY')
            elif ('UsageDescription' in key or key.startswith('NS')) and key not in BENIGN_NS:
                require(key in PERMISSIONS and item == PERMISSIONS[key], 'PLIST_SENSITIVE_KEY')
            elif (key.startswith('UI') and key not in BENIGN_UI) or (
                    key.startswith('LS') and key not in BENIGN_LS) or key.startswith(('WK', 'UT', 'NFC')):
                raise Invalid('PLIST_SENSITIVE_KEY')
            if key == 'UIRequiredDeviceCapabilities':
                require(isinstance(item, list) and set(item) <= {'arm64'}, 'PLIST_CAPABILITIES')
            if key == 'CFBundleURLTypes':
                require(isinstance(item, list) and all(isinstance(url, dict) and
                        set(url) <= {'CFBundleURLName', 'CFBundleTypeRole', 'CFBundleURLSchemes'} and
                        isinstance(url.get('CFBundleURLSchemes'), list) and
                        1 <= len(url['CFBundleURLSchemes']) <= 2 and
                        all(scheme in ('piguimobile', BUNDLE_ID) for scheme in url['CFBundleURLSchemes'])
                        for url in item), 'PLIST_URL_SCHEME')
            plist_policy(item, allow_template_scene)
    elif isinstance(value, list):
        for item in value:
            plist_policy(item, allow_template_scene)


class Tree:
    def __init__(self, source):
        self.zip = None
        self.paths = {}
        self.directories = set()
        source = pathlib.Path(source)
        source_stat = checked_filesystem_path(source)
        if stat.S_ISDIR(source_stat.st_mode):
            self.prefix = ''
            self.app = source
            for root, dirs, files in os.walk(source, followlinks=False):
                for name in dirs + files:
                    path = pathlib.Path(root) / name
                    checked = checked_filesystem_path(path, source)
                    require(not any(ord(char) < 32 or char in ':\\\\' for char in name), 'ARCHIVE_PATH')
                    mode = checked.st_mode
                    require(stat.S_ISREG(mode) or stat.S_ISDIR(mode), 'ARCHIVE_SPECIAL_FILE')
                    if stat.S_ISREG(mode):
                        self.paths[path.relative_to(source).as_posix()] = path
                    else:
                        self.directories.add(path.relative_to(source).as_posix())
        else:
            require(stat.S_ISREG(source_stat.st_mode), 'ARCHIVE_NOT_FOUND')
            self.zip = zipfile.ZipFile(source)
            entries = self.zip.infolist()
            require(0 < len(entries) <= 100000, 'ARCHIVE_ENTRIES')
            total, names, roots = 0, set(), set()
            for entry in entries:
                name = entry.filename
                require(name not in names, 'ARCHIVE_DUPLICATE')
                names.add(name)
                path = pathlib.PurePosixPath(name)
                require(not any(ord(char) < 32 or char in ':\\\\' for char in name) and not path.is_absolute()
                        and all(part not in ('', '.', '..') for part in name.rstrip('/').split('/')),
                        'ARCHIVE_PATH')
                require(len(path.parts) >= 2 and path.parts[0] == 'Payload' and
                        path.parts[1].endswith('.app'), 'ARCHIVE_LAYOUT')
                roots.add(path.parts[1])
                mode = entry.external_attr >> 16
                kind = stat.S_IFMT(mode)
                require(kind in (0, stat.S_IFREG, stat.S_IFDIR) and not entry.flag_bits & 1,
                        'ARCHIVE_SPECIAL_FILE')
                require(entry.file_size <= MAX_FILE, 'ARCHIVE_SIZE')
                total += entry.file_size
                require(total <= MAX_ARCHIVE, 'ARCHIVE_SIZE')
                if entry.is_dir():
                    self.directories.add('/'.join(path.parts[2:]))
                else:
                    require(len(path.parts) >= 3, 'ARCHIVE_LAYOUT')
                    self.paths['/'.join(path.parts[2:])] = entry
            require(roots == {'PiGUIMobile.app'}, 'ARCHIVE_LAYOUT')
            self.prefix = 'Payload/PiGUIMobile.app/'
        require('Info.plist' in self.paths, 'BUNDLE_INFO_MISSING')
        folded = [name.casefold() for name in self.paths]
        require(len(set(folded)) == len(folded), 'ARCHIVE_DUPLICATE')

    def read(self, name, head=None):
        entry = self.paths[name]
        if self.zip:
            with self.zip.open(entry) as stream:
                return stream.read(head) if head else stream.read()
        require(entry.stat().st_size <= MAX_FILE, 'ARCHIVE_SIZE')
        with entry.open('rb') as stream:
            return stream.read(head) if head else stream.read()

    def executable(self, name):
        entry = self.paths[name]
        mode = entry.external_attr >> 16 if self.zip else entry.stat().st_mode
        return bool(mode & 0o111)

    def close(self):
        if self.zip:
            self.zip.close()


def verify(source):
    tree = Tree(source)
    try:
        plists, binaries = {}, {}
        frameworks = {name for name in tree.directories if name.endswith('.framework')}
        require(not any('_CodeSignature' in pathlib.PurePosixPath(name).parts for name in tree.directories),
                'SIGNING_MATERIAL')
        for name in sorted(tree.paths):
            path = pathlib.PurePosixPath(name)
            lower = name.lower()
            require(not any(part.lower() == '_codesignature' for part in path.parts)
                    and path.name.lower() not in ('coderesources', 'embedded.mobileprovision',
                                                   'resourcerules.plist', 'exportoptions.plist')
                    and not lower.endswith(('.mobileprovision', '.provisionprofile', '.entitlements',
                                            '.xcent', 'entitlements.plist',
                                            '.p12', '.pfx', '.pem', '.key', '.cer', '.der')),
                    'SIGNING_MATERIAL')
            require(not any(part.endswith(('.app', '.appex', '.xpc')) for part in path.parts[:-1]),
                    'NESTED_EXECUTABLE_BUNDLE')
            for i, part in enumerate(path.parts[:-1]):
                if part.endswith('.framework'):
                    frameworks.add('/'.join(path.parts[:i + 1]))
            if lower.endswith('.plist'):
                require(len(tree.read(name, 2 * 1024 * 1024 + 1)) <= 2 * 1024 * 1024, 'PLIST_SIZE')
                try:
                    info = plistlib.loads(tree.read(name))
                except Exception as error:
                    raise Invalid('PLIST_INVALID') from error
                plist_policy(info)
                plists[name] = info
            head = tree.read(name, 4)
            if head in MAGICS:
                binaries[name] = macho(tree.read(name))
            elif tree.executable(name):
                raise Invalid('EXECUTABLE_NOT_MACHO')
        main = plists['Info.plist']
        require(isinstance(main, dict) and main.get('CFBundleIdentifier') == BUNDLE_ID,
                'BUNDLE_IDENTIFIER')
        require(main.get('UIDeviceFamily') == [1, 2], 'BUNDLE_DEVICE_FAMILY')
        app_minimum = version(main.get('MinimumOSVersion'))
        declared = set()
        for name, info in plists.items():
            if pathlib.PurePosixPath(name).name != 'Info.plist' or not isinstance(info, dict):
                continue
            directory = name.rsplit('/', 1)[0] if '/' in name else ''
            if directory.endswith('/Resources'):
                directory = directory[:-len('/Resources')]
            executable = info.get('CFBundleExecutable')
            if not executable:
                require(directory not in frameworks and name != 'Info.plist', 'BUNDLE_EXECUTABLE_MISSING')
                continue
            require(isinstance(executable, str) and re.fullmatch(r'[A-Za-z0-9_.+-]+', executable)
                    and executable not in ('.', '..'), 'BUNDLE_EXECUTABLE_NAME')
            binary = (directory + '/' if directory else '') + executable
            require(binary in binaries, 'BUNDLE_EXECUTABLE_MISSING')
            expected_type = 2 if not directory else 6 if directory in frameworks else 8
            require(binaries[binary]['filetype'] == expected_type, 'BUNDLE_EXECUTABLE_TYPE')
            require(info.get('CFBundleSupportedPlatforms') == ['iPhoneOS'] and
                    info.get('DTPlatformName', 'iphoneos') == 'iphoneos' and
                    isinstance(info.get('DTSDKName', 'iphoneos'), str) and
                    re.fullmatch(r'iphoneos(?:[1-9][0-9]?(?:\.[0-9]{1,2}){0,2})?',
                                 info.get('DTSDKName', 'iphoneos')) is not None, 'BUNDLE_PLATFORM')
            minimum = version(info.get('MinimumOSVersion'))
            require(binaries[binary]['minimum'] <= minimum <= app_minimum, 'BUNDLE_MINIMUM_OS')
            declared.add(directory)
        require('' in declared and frameworks <= declared, 'FRAMEWORK_EXECUTABLE_MISSING')
        require(all(item['minimum'] <= app_minimum for item in binaries.values()), 'MACHO_MINIMUM_OS')
        if tree.zip:
            require(tree.zip.testzip() is None, 'ARCHIVE_CRC')
        return {'schemaVersion': 2, 'passed': True, 'kind': 'unsigned-device-archive' if tree.zip else
                'unsigned-device-directory', 'code': 'IPA_VERIFIED', 'bundleId': BUNDLE_ID,
                'minimumOS': '.'.join(map(str, app_minimum)), 'platform': 'iOS',
                'architectures': ['arm64'], 'executables': len(binaries), 'frameworks': len(frameworks),
                'sideStoreInstallVerified': False}
    finally:
        tree.close()


def main():
    try:
        require(len(sys.argv) == 2, 'IPA_ARGUMENTS')
        result = verify(sys.argv[1])
        print(json.dumps(result, sort_keys=True))
        return 0
    except Invalid as error:
        print(json.dumps({'schemaVersion': 2, 'passed': False, 'code': str(error)}))
    except Exception:
        print(json.dumps({'schemaVersion': 2, 'passed': False, 'code': 'IPA_INSPECTION_ERROR'}))
    return 1


if __name__ == '__main__':
    sys.exit(main())
