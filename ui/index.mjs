globalThis.UIComponents = {};
globalThis.UIComponents = {};

import { Hello } from "./test.mjs"; // TODO
import { PrimaryButton } from "./components/buttons.mjs"; // TODO
import { Collapse } from "./components/collapse.mjs"; // TODO
const UIComponents = { Hello, PrimaryButton, Collapse };
globalThis.UIComponents = UIComponents;
export default UIComponents;
//console.log(globalThis);