import { readFileSync, appendFileSync } from 'node:fs';
const devices = JSON.parse(readFileSync('artifacts/simulators.json', 'utf8')).devices;
const runtimes = Object.keys(devices).filter(k => /SimRuntime.iOS-(26|27)-/.test(k)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
let chosen;
for (const runtime of runtimes) {
  const available = devices[runtime].filter(d => d.isAvailable);
  const iphone = available.find(d => d.name === 'iPhone 17') ?? available.find(d => d.name.startsWith('iPhone'));
  const ipad = available.find(d => d.name.startsWith('iPad'));
  if (iphone && ipad) { chosen = { runtime, iphone, ipad }; break; }
}
if (!chosen) throw new Error('No iOS 26+ iPhone and iPad simulators available: inspect actual runner inventory');
for (const [key, value] of Object.entries({ IPHONE_UDID: chosen.iphone.udid, IPAD_UDID: chosen.ipad.udid, IOS_RUNTIME: chosen.runtime })) appendFileSync(process.env.GITHUB_ENV, key + '=' + value + '\n');
console.log(JSON.stringify(chosen, null, 2));
