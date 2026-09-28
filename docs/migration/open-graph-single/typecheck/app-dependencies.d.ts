// Stand-ins for open-graph-single's own dependencies, which are not installed in this repository.
// They only need to cover what files/ uses; the real types apply inside the app.

declare module "express" {
  namespace express {
    type Request = any;
    type Response = any;
  }
  const express: any;
  export default express;
}

declare module "vite" {
  export const createServer: (options?: unknown) => Promise<any>;
}

declare module "dotenv" {
  const dotenv: { config: (options?: unknown) => unknown };
  export default dotenv;
}
