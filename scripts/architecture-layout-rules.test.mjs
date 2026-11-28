import test from "node:test";
import assert from "node:assert/strict";
import {
  checkFileName, checkClassName, checkModuleEntry, checkConsumerLocation, checkSpecLocation, checkAlias, expectedClassName, parseFileName, pascal,
} from "./architecture-layout-rules.mjs";

test("accepts <kebab-name>.<allowed-kind>.ts and rejects the rest", () => {
  assert.deepEqual(checkFileName("modules/orders/services/orders.service.ts"), []);
  assert.deepEqual(checkFileName("modules/orders/jobs/unpaid-orders.job.ts"), []);
  assert.match(checkFileName("modules/orders/jobs/unpaid-orders.cron.ts")[0], /not an allowed kind/);
  assert.match(checkFileName("modules/orders/services/orders.ts")[0], /has no kind/);
  assert.match(checkFileName("modules/orders/services/OrdersService.service.ts")[0], /kebab-case/);
  assert.match(checkFileName("modules/orders/services/orders_service.service.ts")[0], /kebab-case/);
});

test("exempts entry points, barrels, declaration files and test helpers", () => {
  for (const f of ["main.ts", "bootstrap/worker.ts", "bootstrap/instrument.ts", "modules/x/utils/index.ts", "common/types/redlock.d.ts", "infrastructure/messaging/rabbitmq/consumer-harness-spec.ts"]) {
    assert.deepEqual(checkFileName(f), [], f);
  }
  assert.match(checkFileName("modules/x/random.ts")[0], /has no kind/);
});

test("specs are checked for kebab-case only", () => {
  assert.deepEqual(checkFileName("modules/x/services/a.service.spec.ts"), []);
  assert.deepEqual(checkFileName("modules/x/services/automatic-discounts.spec.ts"), []);
  assert.match(checkFileName("modules/x/services/AutoDiscounts.spec.ts")[0], /kebab-case/);
});

test("the exported class must be PascalCase(name) + the kind suffix", () => {
  assert.equal(expectedClassName("admin-vendors.service.ts"), "AdminVendorsService");
  assert.equal(expectedClassName("unpaid-orders.job.ts"), "UnpaidOrdersJob");
  assert.equal(expectedClassName("orders.dto.ts"), null);
  assert.deepEqual(checkClassName("a/orders.service.ts", "export class OrdersService {}"), []);
  assert.match(checkClassName("a/orders.service.ts", "export class Orders {}")[0], /must export class OrdersService/);
  assert.match(checkClassName("a/unpaid-orders.job.ts", "export class UnpaidOrdersCron {}")[0], /UnpaidOrdersJob/);
  assert.deepEqual(checkClassName("a/orders.service.ts", "const x = 1;"), []);
});

test("parses names and cases", () => {
  assert.deepEqual(parseFileName("a-b.service.spec.ts"), { stem: "a-b", kind: "service", spec: true });
  assert.deepEqual(parseFileName("main.ts"), { stem: "main", kind: null, spec: false });
  assert.equal(pascal("audit-log"), "AuditLog");
});

test("a module holds only its module file and standard folders", () => {
  assert.deepEqual(checkModuleEntry("orders.module.ts"), []);
  assert.deepEqual(checkModuleEntry("auth-cookie.module.ts"), []);
  assert.deepEqual(checkModuleEntry("services/orders.service.ts"), []);
  assert.match(checkModuleEntry("orders.service.ts")[0], /module root/);
  assert.match(checkModuleEntry("admin/thing.service.ts")[0], /not a standard module folder/);
});

test("consumers live in modules/*/consumers or infrastructure/workflows", () => {
  assert.deepEqual(checkConsumerLocation("modules/audit/consumers/audit.consumer.ts"), []);
  assert.deepEqual(checkConsumerLocation("infrastructure/workflows/workflow-start.consumer.ts"), []);
  assert.match(checkConsumerLocation("infrastructure/messaging/rabbitmq/email.consumer.ts")[0], /belong in modules/);
  assert.deepEqual(checkConsumerLocation("modules/x/services/a.service.ts"), []);
});

test("only the @api alias exists", () => {
  assert.deepEqual(checkAlias("@api/common/utils"), []);
  assert.deepEqual(checkAlias("@nestjs/common"), []);
  assert.match(checkAlias("@common/utils")[0], /removed alias/);
  assert.match(checkAlias("@infra/cache")[0], /removed alias/);
});

test("a module's specs live in its tests folder", () => {
  assert.deepEqual(checkSpecLocation("modules/orders/tests/order-status.service.spec.ts"), []);
  assert.deepEqual(checkSpecLocation("modules/orders/tests/orders.module.spec.ts"), []);
  assert.match(checkSpecLocation("modules/orders/tests/services/order-status.service.spec.ts")[0], /no subfolders/);
  assert.match(checkSpecLocation("modules/orders/services/order-status.service.spec.ts")[0], /belong directly in modules\/orders\/tests/);
  assert.match(checkSpecLocation("modules/orders/orders.module.spec.ts")[0], /belong directly in modules\/orders\/tests/);
  // outside the modules the rule does not apply, and end-to-end specs are not unit specs
  assert.deepEqual(checkSpecLocation("common/utils/x.util.spec.ts"), []);
  assert.deepEqual(checkSpecLocation("modules/payments/tests/payment-flow.e2e-spec.ts"), []);
});
