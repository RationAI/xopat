globalThis.UIComponents = {};

import { Hello } from "./test.mjs"; // TODO
import { PrimaryButton } from "./components/buttons.mjs"; // TODO
const UIComponents = { Hello, PrimaryButton };
globalThis.UIComponents = UIComponents;
export default UIComponents;
//console.log(globalThis);