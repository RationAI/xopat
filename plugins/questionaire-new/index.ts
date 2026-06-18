import { QuestionnairePlugin } from "./plugin";
import { registerQuestionnaireScriptingApi } from "./scripting/api";

addPlugin("questionaire", QuestionnairePlugin);

// Expose the `questionnaire` scripting namespace (read schema/answers + build/edit
// the questionnaire). Enables LLM integration via the vercel-ai-chat-sdk module.
registerQuestionnaireScriptingApi();
