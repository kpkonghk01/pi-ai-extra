// Stand-ins for auto-og's own dependencies, which are not installed in this repository.
// They only need to cover what files/ uses; the real types apply inside the app
// (auto-og has no @types/react, so React is untyped there too).

declare module "express" {
  namespace express {
    type Request = any;
    type Response = any;
  }
  export type Request = any;
  export type Response = any;
  const express: any;
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

declare module "@google/genai" {
  export class GoogleGenAI {
    constructor(options: { apiKey: string });
    models: any;
  }
}

// auto-og resolves React from react/index.js (allowJs). This covers the hooks files/ uses.
declare module "react" {
  namespace React {
    type FC<P = {}> = (props: P) => any;
    type ReactNode = any;
    function useState<S>(initial: S | (() => S)): [S, (value: S | ((previous: S) => S)) => void];
    function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  }
  export = React;
}
declare module "react/jsx-runtime";
declare module "lucide-react";
