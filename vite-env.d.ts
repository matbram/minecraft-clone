/// <reference types="vite/client" />

// Allow importing GLSL shader sources as raw strings, e.g. `import src from './x.glsl?raw'`.
declare module '*.glsl?raw' {
  const content: string;
  export default content;
}
