// Stand-ins for opengraph2's own dependencies, which are not installed in this repository.
// They only need to cover what files/ uses; the real types apply inside the app.

declare module "express" {
  const express: any;
  namespace express {
    type Response = any;
  }
  export default express;
}

declare module "vite" {
  export const createServer: (options?: unknown) => Promise<any>;
  export const defineConfig: (config: unknown) => unknown;
}

declare module "@vitejs/plugin-react" {
  const react: () => unknown;
  export default react;
}

declare module "@tailwindcss/vite" {
  const tailwindcss: () => unknown;
  export default tailwindcss;
}

declare module "dotenv" {
  const dotenv: { config(): unknown };
  export default dotenv;
}

declare module "@google/genai" {
  export class GoogleGenAI {
    constructor(options: { apiKey: string });
    models: any;
  }
}
