globalThis.UIComponents = {};

import { Hello } from "./test.mjs"; // TODO
import { TestButton } from "./components/testButton.mjs"; // TODO
const UIComponents = { Hello, TestButton };
globalThis.UIComponents = UIComponents;
export default UIComponents;
//console.log(globalThis);