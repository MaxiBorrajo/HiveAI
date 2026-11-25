import { assertEquals } from "@std/assert";
import { initORM } from "../../../../infrastructure/db/orm.ts";

type Row = Record<string, unknown>;

Deno.test("deleting an api key or a run keeps the records that mention it, with the reference cleared", async () => {
  const db = await initORM(await Deno.makeTempDir());
  const sql = db.$client;
  sql.exec(`
    INSERT INTO api_keys(id,provider,alias,last4,created_at,updated_at) VALUES ('k1','a','work','1234',1,1);
    INSERT INTO executions(id,name,createdAt,updatedAt) VALUES (1,'e',1,1);
    INSERT INTO execution_graphs(id,executionId,graph,state,orchestratorProvider,orchestratorModel,orchestratorKeyId,createdAt) VALUES (1,1,'{}','{}','a','m','k1',1);
    INSERT INTO execution_history(id,executionId,iteration,result,graphId,createdAt) VALUES (7,1,1,'{}',1,1);
    INSERT INTO model_usage(id,group_id,context_kind,provider,model,location,role,key_id,key_alias,duration_ms,status,created_at) VALUES (1,'g','chat','a','m','cloud','orchestrator','k1','work',1,'ok',1);
    INSERT INTO schedules(id,executionId,frequency,timeOfDay,cron,input,enabled,nextRunAt,createdAt,updatedAt) VALUES (1,1,'daily','10:00','','',1,1,1,1);
    INSERT INTO schedule_runs(id,scheduleId,executionId,scheduledFor,status,historyId,startedAt) VALUES (1,1,1,1,'ok',7,1);
    INSERT INTO execution_rubrics(id,executionId,version,rubric,createdAt) VALUES (1,1,1,'r',1);
    INSERT INTO run_grades(id,historyId,rubricId,judgeProvider,judgeModel,judgeKeyId,judgeVersion,status,createdAt) VALUES (1,7,1,'a','m','k1',1,'graded',1);
  `);

  sql.exec("DELETE FROM api_keys WHERE id = 'k1'");
  assertEquals(sql.prepare("SELECT key_id, key_alias FROM model_usage").get() as Row, { key_id: null, key_alias: "work" });
  assertEquals((sql.prepare("SELECT judgeKeyId k FROM run_grades").get() as Row).k, null);
  assertEquals((sql.prepare("SELECT orchestratorKeyId k FROM execution_graphs").get() as Row).k, null);

  // A run keeps existing when the graph version it used is deleted.
  sql.exec("DELETE FROM execution_graphs WHERE id = 1");
  assertEquals((sql.prepare("SELECT graphId g FROM execution_history").get() as Row).g, null);

  // A grade belongs to its run and goes with it; the schedule log only forgets the link.
  sql.exec("DELETE FROM execution_history WHERE id = 7");
  assertEquals((sql.prepare("SELECT historyId h FROM schedule_runs").get() as Row).h, null);
  assertEquals((sql.prepare("SELECT count(*) n FROM run_grades").get() as Row).n, 0);
});
