// 院内计算后端（agent）共享凭证的口径 —— 连接器与 agent 两侧必须一致。
// agent 侧服务端拦截器：apps/agent/src/medtrust_agent/grpc_server.py。
export const AGENT_TOKEN_METADATA_KEY = 'x-agent-token';
