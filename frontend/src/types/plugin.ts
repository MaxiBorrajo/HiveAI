export interface PluginTestCase {
  query: string;
  shouldInvoke: boolean;
  expectedParams?: Record<string, unknown>;
  expectedOutputValues?: string[];
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  active: boolean;
  testCases: PluginTestCase[];
}
