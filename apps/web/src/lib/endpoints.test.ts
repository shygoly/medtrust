import test from "node:test";
import assert from "node:assert/strict";
import { resolveWsBase } from "./endpoints";

test("显式配置的 WS 地址优先（去掉末尾斜杠）", () => {
  assert.equal(resolveWsBase("/api/v1", "wss://api.example.org/", { protocol: "https:", host: "web.example.org" }), "wss://api.example.org");
});

test("API 走同源相对路径时，WS 跟随页面同源（https→wss）", () => {
  assert.equal(resolveWsBase("/api/v1", undefined, { protocol: "https:", host: "web.szchada.top" }), "wss://web.szchada.top");
  assert.equal(resolveWsBase("/api/v1", "", { protocol: "http:", host: "localhost:5020" }), "ws://localhost:5020");
});

test("本地开发（API 直连 :5021）保持原默认", () => {
  assert.equal(resolveWsBase("http://localhost:5021/api/v1", undefined, { protocol: "http:", host: "localhost:5020" }), "ws://localhost:5021");
  assert.equal(resolveWsBase("/api/v1", undefined, undefined), "ws://localhost:5021");
});
