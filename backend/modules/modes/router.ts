import { Hono } from "hono";
import { getModes } from "./useCases/getModes/index.ts";

export const modesRouter = new Hono();

modesRouter.get("/", () => {
  return getModes({ "content-type": "application/json" });
});
