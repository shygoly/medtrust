# RBAC 权限系统实现

## 背景

当前 MedTrust Lite 版本使用简单的模拟认证，没有真正的用户认证和权限控制。为了支持多租户、多角色的医疗数据可信空间，需要实现完整的 RBAC（Role-Based Access Control）权限系统。

## 目标

1. **认证系统**: 实现基于 JWT 的用户认证
2. **权限模型**: 实现角色-权限-用户的 RBAC 模型
3. **数据隔离**: 支持多租户数据隔离（机构级、科室级、个人级）
4. **API 保护**: 所有 API 端点都需要认证和权限验证
5. **前端集成**: 前端自动携带 token，支持权限控制的 UI 展示

## 技术方案

### 数据库设计

#### 1. 用户表（users）

```sql
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(100),
  real_name VARCHAR(100) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  department_id VARCHAR(36),
  data_scope ENUM('all', 'tenant', 'department', 'self') DEFAULT 'self',
  status ENUM('active', 'inactive', 'locked') DEFAULT 'active',
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted BOOLEAN DEFAULT FALSE,
  INDEX idx_username (username),
  INDEX idx_tenant (tenant_id),
  INDEX idx_email (email)
);
```

#### 2. 角色表（roles）

```sql
CREATE TABLE roles (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  tenant_id VARCHAR(36),  -- NULL 表示系统角色
  data_scope ENUM('all', 'tenant', 'department', 'self') DEFAULT 'self',
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_tenant (tenant_id)
);
```

#### 3. 权限表（permissions）

```sql
CREATE TABLE permissions (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  resource VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_resource_action (resource, action)
);
```

#### 4. 角色权限关联表（role_permissions）

```sql
CREATE TABLE role_permissions (
  id VARCHAR(36) PRIMARY KEY,
  role_id VARCHAR(36) NOT NULL,
  permission_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE KEY uk_role_permission (role_id, permission_id)
);
```

#### 5. 用户角色关联表（user_roles）

```sql
CREATE TABLE user_roles (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  role_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_role (user_id, role_id)
);
```

### 权限定义

#### 资源和操作

```typescript
// 资源类型
enum Resource {
  TENANT = 'tenant',           // 机构管理
  ASSET = 'asset',             // 数据资产
  ACCESS_REQUEST = 'access-request',  // 申请审批
  BLOCKCHAIN = 'blockchain',   // 区块链存证
  USER = 'user',               // 用户管理
  ROLE = 'role',               // 角色管理
  PERMISSION = 'permission',   // 权限管理
  COMPUTE_TASK = 'compute-task', // 计算任务
}

// 操作类型
enum Action {
  READ = 'read',
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  APPROVE = 'approve',
  VERIFY = 'verify',
}

// 权限格式: resource:action
// 例如: tenant:read, asset:create, access-request:approve
```

#### 预定义角色

```typescript
// 系统管理员
const ADMIN_ROLE = {
  code: 'admin',
  name: '系统管理员',
  permissions: ['*'],  // 所有权限
  dataScope: 'all',
};

// 数据提供方管理员
const PROVIDER_ADMIN_ROLE = {
  code: 'provider-admin',
  name: '数据提供方管理员',
  permissions: [
    'asset:read', 'asset:create', 'asset:update',
    'access-request:read', 'access-request:approve',
    'blockchain:read', 'blockchain:verify',
    'user:read', 'user:create',
  ],
  dataScope: 'tenant',
};

// 数据消费方
const CONSUMER_ROLE = {
  code: 'consumer',
  name: '数据消费方',
  permissions: [
    'asset:read',
    'access-request:read', 'access-request:create',
    'compute-task:read', 'compute-task:create',
  ],
  dataScope: 'tenant',
};

// 监管方
const REGULATOR_ROLE = {
  code: 'regulator',
  name: '监管方',
  permissions: [
    'tenant:read',
    'asset:read',
    'access-request:read', 'access-request:approve',
    'blockchain:read', 'blockchain:verify',
  ],
  dataScope: 'all',
};
```

### 后端实现

#### API 端点

```typescript
// 认证相关
POST   /api/auth/login           // 登录
POST   /api/auth/logout          // 登出
GET    /api/auth/profile         // 获取当前用户信息
POST   /api/auth/refresh         // 刷新 token

// 用户管理
GET    /api/users                // 获取用户列表
GET    /api/users/:id            // 获取用户详情
POST   /api/users                // 创建用户
PUT    /api/users/:id            // 更新用户
DELETE /api/users/:id            // 删除用户
PUT    /api/users/:id/roles      // 分配角色

// 角色管理
GET    /api/roles                // 获取角色列表
GET    /api/roles/:id            // 获取角色详情
POST   /api/roles                // 创建角色
PUT    /api/roles/:id            // 更新角色
DELETE /api/roles/:id            // 删除角色
PUT    /api/roles/:id/permissions // 分配权限

// 权限管理
GET    /api/permissions          // 获取权限列表
```

#### JWT 认证流程

```typescript
// 1. 用户登录
POST /api/auth/login
Request: { username: string, password: string }
Response: {
  access_token: string,
  refresh_token: string,
  user: {
    id: string,
    username: string,
    realName: string,
    tenantId: string,
    roles: Role[],
    permissions: string[],
    dataScope: string,
  }
}

// 2. 访问受保护资源
GET /api/assets
Headers: { Authorization: 'Bearer {access_token}' }

// 3. Token 刷新
POST /api/auth/refresh
Request: { refresh_token: string }
Response: { access_token: string }
```

#### 权限守卫实现

```typescript
// 权限装饰器
@Permissions('asset:read', 'asset:create')
@Get()
async findAll(@Request() req) {
  const user = req.user;
  // 自动应用 dataScope 过滤
  return this.assetsService.findAll(user);
}

// 数据范围过滤
class AssetsService {
  async findAll(user: User) {
    const query = this.buildDataScopeQuery(user);
    return this.assetsRepository.find(query);
  }

  private buildDataScopeQuery(user: User) {
    switch (user.dataScope) {
      case 'all':
        return {};
      case 'tenant':
        return { tenantId: user.tenantId };
      case 'department':
        return { tenantId: user.tenantId, departmentId: user.departmentId };
      case 'self':
        return { createdBy: user.id };
    }
  }
}
```

### 前端实现

#### Auth Hook 更新

```typescript
// hooks/use-auth.ts
interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

// 自动添加 Authorization header
const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Token 过期，清除并跳转登录
    localStorage.removeItem('auth_token');
    localStorage.removeItem('current_user');
    window.location.href = '/auth/login';
    throw new Error('Unauthorized');
  }

  return response;
};
```

#### 权限控制组件

```typescript
// components/auth/permission-guard.tsx
export function PermissionGuard({
  permissions,
  fallback = null,
  children,
}: {
  permissions: string[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { hasAnyPermission } = useAuth();

  if (!hasAnyPermission(permissions)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// 使用示例
<PermissionGuard permissions={['asset:create']}>
  <Button>上架数据资产</Button>
</PermissionGuard>
```

## 实现计划

### Phase 1: 数据库和后端基础
- [ ] 创建数据库表结构
- [ ] 实现 User、Role、Permission 实体
- [ ] 实现 JWT 认证服务
- [ ] 实现认证守卫和权限守卫
- [ ] 添加密码哈希（bcrypt）

### Phase 2: 认证 API
- [ ] 实现登录接口
- [ ] 实现登出接口
- [ ] 实现获取当前用户接口
- [ ] 实现 token 刷新接口

### Phase 3: 用户和角色管理 API
- [ ] 实现用户 CRUD 接口
- [ ] 实现角色 CRUD 接口
- [ ] 实现权限查询接口
- [ ] 实现角色分配接口

### Phase 4: 现有 API 保护
- [ ] 为所有 API 端点添加认证守卫
- [ ] 为敏感操作添加权限守卫
- [ ] 实现数据范围过滤
- [ ] 更新 API 响应格式

### Phase 5: 前端集成
- [ ] 更新 Auth Hook 支持 JWT
- [ ] 更新 API 客户端自动添加 token
- [ ] 更新登录页面处理新响应
- [ ] 实现权限控制组件
- [ ] 更新菜单权限过滤

### Phase 6: 初始数据和测试
- [ ] 创建初始角色和权限
- [ ] 创建测试用户
- [ ] 测试登录流程
- [ ] 测试权限控制
- [ ] 测试数据隔离

## 数据迁移

### 初始权限数据

```sql
-- 插入基础权限
INSERT INTO permissions (id, code, name, resource, action) VALUES
  (UUID(), 'tenant:read', '查看机构', 'tenant', 'read'),
  (UUID(), 'tenant:create', '创建机构', 'tenant', 'create'),
  (UUID(), 'asset:read', '查看数据资产', 'asset', 'read'),
  (UUID(), 'asset:create', '创建数据资产', 'asset', 'create'),
  (UUID(), 'asset:update', '更新数据资产', 'asset', 'update'),
  (UUID(), 'access-request:read', '查看申请', 'access-request', 'read'),
  (UUID(), 'access-request:create', '创建申请', 'access-request', 'create'),
  (UUID(), 'access-request:approve', '审批申请', 'access-request', 'approve'),
  (UUID(), 'blockchain:read', '查看区块链', 'blockchain', 'read'),
  (UUID(), 'blockchain:verify', '验证存证', 'blockchain', 'verify'),
  (UUID(), 'user:read', '查看用户', 'user', 'read'),
  (UUID(), 'user:create', '创建用户', 'user', 'create'),
  (UUID(), 'user:update', '更新用户', 'user', 'update'),
  (UUID(), 'user:delete', '删除用户', 'user', 'delete');

-- 插入系统角色
INSERT INTO roles (id, code, name, data_scope, is_system) VALUES
  (UUID(), 'admin', '系统管理员', 'all', TRUE),
  (UUID(), 'provider-admin', '数据提供方管理员', 'tenant', TRUE),
  (UUID(), 'consumer', '数据消费方', 'tenant', TRUE),
  (UUID(), 'regulator', '监管方', 'all', TRUE);
```

### 测试用户

```sql
-- 创建测试用户（密码: password123）
INSERT INTO users (id, username, password_hash, real_name, tenant_id, data_scope) VALUES
  (UUID(), 'admin', '$2b$10$...', '系统管理员', '1', 'all'),
  (UUID(), 'hospital1', '$2b$10$...', '示范甲医院管理员', '1', 'tenant'),
  (UUID(), 'researcher1', '$2b$10$...', '研究员', '3', 'tenant'),
  (UUID(), 'regulator1', '$2b$10$...', '监管员', '5', 'all');
```

## 验收标准

- [ ] 用户可以使用用户名密码登录
- [ ] 登录后获得 JWT token
- [ ] 所有 API 请求需要携带 token
- [ ] 无权限用户无法访问受保护资源
- [ ] 数据范围过滤正确工作
- [ ] Token 过期后自动跳转登录
- [ ] 前端菜单根据权限动态显示
- [ ] 按钮和操作根据权限显示/隐藏

## 相关文件

- `backend/src/auth/` - 认证模块
- `backend/src/users/` - 用户管理
- `backend/src/roles/` - 角色管理
- `backend/src/permissions/` - 权限管理
- `fly-services/lite/Dockerfile.api` - API 服务
- `fly-services/lite/web/index.html` - 前端页面

## 安全考虑

1. **密码安全**: 使用 bcrypt 哈希，salt rounds >= 10
2. **Token 安全**: JWT secret 使用环境变量，定期轮换
3. **Token 过期**: access_token 15分钟，refresh_token 7天
4. **HTTPS**: 生产环境强制使用 HTTPS
5. **SQL 注入**: 使用参数化查询
6. **XSS 防护**: 前端输入验证和转义
7. **CSRF 防护**: 使用 SameSite cookie 或 CSRF token
