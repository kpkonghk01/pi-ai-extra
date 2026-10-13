// Stand-ins for og-master's own dependencies, which are not installed in this repository.
// They only need to cover what files/ uses; the real types apply inside the app.

declare module "express" {
  const express: any;
  namespace express {
    type Request = any;
    type Response = any;
    type NextFunction = any;
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
