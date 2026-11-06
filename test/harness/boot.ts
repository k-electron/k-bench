import { createTestInstance } from "./instance.ts";

/** A started server with one Workspace, on a folder named "project". */
export async function bootWithWorkspace() {
  const instance = createTestInstance();
  const server = await instance.start();
  const workspace = await server.createWorkspace({
    folder: instance.makeFolder("project"),
  });
  return { instance, server, workspace };
}
