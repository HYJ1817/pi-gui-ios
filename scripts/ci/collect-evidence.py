#!/usr/bin/env python3
"""Publish a fixed set of synthetic images and reconstructed, content-free JUnit.

No raw logs, test names, error strings, simulator inventory, PNG text or paths pass
through. Inputs originate only in this job's isolated synthetic simulator run.
"""
import json
import importlib.util
import os
import pathlib
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

_spec = importlib.util.spec_from_file_location('native_safe_diagnostics', pathlib.Path(__file__).with_name('safe-diagnostics.py'))
diagnostics = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(diagnostics)

STEPS = ('environment', 'npm', 'prebuild', 'pods', 'maestro', 'simulator-build',
         'iphone', 'ipad', 'device-build', 'ipa')
SHOTS = ('01-native-glass.png', '02-interactions.png', '03-navigation.png', '04-keyboard-visible.png', '05-native-motion.png', '06-native-menu.png',
         'dark/appearance.png', 'accessibility/reduce-transparency.png',
         'accessibility/dynamic-type.png', 'final.png', 'failure.png')
PHASES = ('native', 'dark', 'accessibility')


def read(path, limit):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError()
    return path.read_bytes()


def png(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError()
    output = bytearray(data[:8])
    offset, first, ended, compressed = 8, True, False, bytearray()
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError()
        size, = struct.unpack_from('>I', data, offset)
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + size
        if end > len(data):
            raise ValueError()
        body = data[offset + 8:end - 4]
        crc, = struct.unpack_from('>I', data, end - 4)
        if zlib.crc32(kind + body) & 0xffffffff != crc:
            raise ValueError()
        if first:
            if kind != b'IHDR' or size != 13:
                raise ValueError()
            width, height, depth, colour, compression, filtering, interlace = struct.unpack('>IIBBBBB', body)
            if not (0 < width <= 4096 and 0 < height <= 4096 and depth == 8 and colour in (2, 6)
                    and compression == filtering == interlace == 0):
                raise ValueError()
            bound = (width * (3 if colour == 2 else 4) + 1) * height
        if (not first and kind == b'IHDR') or kind in (b'acTL', b'fcTL', b'fdAT'):
            raise ValueError()
        if kind == b'IDAT':
            compressed.extend(body)
        if kind in (b'IHDR', b'IDAT', b'IEND'):
            output.extend(data[offset:end])
        elif kind[0] & 32 == 0:  # No unknown critical chunks / APNG.
            raise ValueError()
        if kind == b'IEND':
            if size or end != len(data):
                raise ValueError()
            ended = True
        first, offset = False, end
    decoder = zlib.decompressobj()
    pixels = decoder.decompress(compressed, bound + 1)
    if not ended or len(pixels) != bound or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError()
    return bytes(output)


def junit(data, device, phase):
    if b'<!' in data:
        raise ValueError()
    source = ET.fromstring(data)
    cases = list(source.iter('testcase'))
    if not cases or len(cases) > 10000:
        raise ValueError()
    suite = ET.Element('testsuite', name=device + '-' + phase, tests=str(len(cases)))
    failed, skipped = 0, 0
    for index, original in enumerate(cases, 1):
        case = ET.SubElement(suite, 'testcase', name='synthetic-assertion-' + str(index), classname=phase)
        if original.find('failure') is not None or original.find('error') is not None:
            ET.SubElement(case, 'failure', message='MAESTRO_ASSERTION_FAILED')
            failed += 1
        elif original.find('skipped') is not None:
            ET.SubElement(case, 'skipped', message='MAESTRO_ASSERTION_SKIPPED')
            skipped += 1
    # Never lose a suite-level error or a missing testcase while reconstructing.
    leaves = [node for node in source.iter('testsuite') if node.find('testsuite') is None]
    declared = sum(int(node.get(key, '0')) for node in leaves for key in ('failures', 'errors'))
    declared = max(declared, max((sum(int(node.get(key, '0')) for key in ('failures', 'errors'))
                                  for node in source.iter() if node.tag in ('testsuite', 'testsuites')), default=0))
    if declared > failed or any('tests' in node.attrib and int(node.get('tests')) !=
                                len(list(node.iter('testcase'))) for node in leaves):
        raise ValueError()
    suite.set('failures', str(failed))
    suite.set('errors', '0')
    suite.set('skipped', str(skipped))
    return ET.tostring(suite, encoding='utf-8', xml_declaration=True)


def collect(private, output):
    reports = output / 'reports'
    reports.mkdir(parents=True, exist_ok=True)
    steps = []
    for step in STEPS:
        path = private / 'steps' / (step + '.json')
        item = {'step': step, 'status': 'not-run'}
        if path.exists():
            value = json.loads(read(path, 1024))
            if set(value) != {'step', 'status'} or value['step'] != step or value['status'] not in (
                    'running', 'passed', 'failed', 'bootstrap-required') or (value['status'] == 'bootstrap-required' and step != 'pods'):
                raise ValueError()
            item = dict(value)
            if item['status'] == 'running':
                item['status'] = 'interrupted'
        item['code'] = 'NATIVE_STEP_' + step.upper().replace('-', '_') + '_' + item['status'].upper().replace('-', '_')
        steps.append(item)
    (reports / 'steps.json').write_text(json.dumps({'schemaVersion': 1, 'steps': steps,
        'sideStoreInstallVerified': False}, sort_keys=True) + '\n', encoding='utf-8')
    failures = [diagnostics.scan(item['step'], [private / 'logs' / (item['step'] + '.log')])
                for item in steps if item['status'] in ('failed', 'interrupted', 'bootstrap-required')]
    for record in failures:
        xcresult = private / 'logs' / (record['step'] + '-xcresult.json')
        if xcresult.is_file():
            try:
                parsed = json.loads(read(xcresult, 1024 * 1024))
            except Exception:
                parsed = None
            if isinstance(parsed, dict) and parsed.get('kind') == 'safe-ci-xcresult':
                # Only the allowlisted structured issue records merge in.
                record['xcresult'] = parsed
    (reports / 'diagnostics.json').write_text(json.dumps({'schemaVersion': 1, 'diagnostics': failures}, sort_keys=True) + '\n', encoding='utf-8')
    (reports / 'environment.json').write_text(json.dumps(diagnostics.environment(private / 'logs/environment.log'), sort_keys=True) + '\n', encoding='utf-8')
    for device in ('iphone', 'ipad'):
        for phase in PHASES:
            source = private / 'ui' / device / (phase + '.xml')
            target = reports / (device + '-' + phase + '.xml')
            target.unlink(missing_ok=True)
            if source.exists():
                target.write_bytes(junit(read(source, 2 * 1024 * 1024), device, phase))
        for phase in PHASES:
            source = private / 'ui' / device / (phase + '-debug.json')
            target = reports / (device + '-' + phase + '-debug.json')
            target.unlink(missing_ok=True)
            if source.exists():
                parsed = json.loads(read(source, 256 * 1024))
                if isinstance(parsed, dict) and parsed.get('kind') == 'maestro-debug' and isinstance(parsed.get('commands'), list):
                    verbs = [c for c in parsed['commands'] if isinstance(c, dict)
                             and all(k in ('index', 'verb', 'status') for k in c)]
                    if len(verbs) == len(parsed['commands']):
                        target.write_text(json.dumps({'schemaVersion': 1, 'kind': 'maestro-debug', 'commands': verbs}, sort_keys=True) + '\n', encoding='utf-8')
        for shot in SHOTS:
            source = private / 'screenshots' / device / shot
            target = output / 'screenshots' / device / shot
            target.unlink(missing_ok=True)
            if source.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(png(read(source, 32 * 1024 * 1024)))


if __name__ == '__main__':
    try:
        collect(pathlib.Path(os.environ['RUNNER_TEMP']) / 'native-private', pathlib.Path('artifacts'))
        print('SYNTHETIC_EVIDENCE_COLLECTED')
    except Exception:
        print('SYNTHETIC_EVIDENCE_REJECTED')
        sys.exit(1)
