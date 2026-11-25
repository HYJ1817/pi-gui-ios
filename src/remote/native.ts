/** Lazy native lookup: importing this module never enables a remote profile. */
import { requireOptionalNativeModule } from 'expo';
import type { NativeRemotePort } from './native-port';
import { ConnectionError } from './transport-policy';

export function nativeRemotePort(): NativeRemotePort {
  const module = requireOptionalNativeModule<NativeRemotePort>('PiGuiRemote');
  if (!module) throw new ConnectionError('disabled');
  return module;
}
