import { onRequestPost as __generate_js_onRequestPost } from "/Users/muroyamasusumu/Documents/cscs_video_quiz/quiz_html/functions/generate.js"
import { onRequest as __api_key_js_onRequest } from "/Users/muroyamasusumu/Documents/cscs_video_quiz/quiz_html/functions/api-key.js"

export const routes = [
    {
      routePath: "/generate",
      mountPath: "/",
      method: "POST",
      middlewares: [],
      modules: [__generate_js_onRequestPost],
    },
  {
      routePath: "/api-key",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__api_key_js_onRequest],
    },
  ]