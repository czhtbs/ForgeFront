// @ts-ignore The same source fingerprint is used by the Node server.
import { simulationVersion } from './server/version.mjs';
export default { base: './', define: { __SIM_VERSION__: JSON.stringify(simulationVersion()) }, server: { proxy: { '/socket': { target: 'ws://127.0.0.1:5182', ws: true } } } };
