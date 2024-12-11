globalThis.UI = {};

import { Hello } from "./test.mjs"; // TODO
import { PrimaryButton } from "./components/buttons.mjs"; // TODO
import { Collapse } from "./components/collapse.mjs"; // TODO
const UI = { Hello, PrimaryButton, Collapse };
globalThis.UI = UI;
export default UI;
//console.log(globalThis);