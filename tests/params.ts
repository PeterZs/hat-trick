// Tests use a fixed parameter set so tuning src/sim/defaultParams.json
// doesn't break them. Update testParams.json deliberately if mechanics change.
import fixed from './testParams.json';
import { cloneParams, type Params } from '../src/sim/params';

export const TEST_PARAMS: Params = cloneParams(fixed as Params);
