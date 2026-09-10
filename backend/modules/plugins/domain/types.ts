import type { ExecutionTestCase, SelectionTestCase } from "../../../core/microkernel/bee-plugin.ts";

export interface PluginDto {
  name: string;
  description: string;
  active: boolean;
  selectionTests?: SelectionTestCase[];
  executionTests?: ExecutionTestCase[];
  isExternal?: boolean;
}

