# Phase 2: Compute Task Management UI

## Overview
Build comprehensive frontend for managing federated learning compute tasks with real-time status monitoring and result visualization.

## ADDED Requirements

### Requirement: Compute Task List Page
**Priority**: P0
**Component**: Frontend

#### Scenario: Display Task List
Given the user is on /dashboard/compute
When the page loads
Then display a table of compute tasks with columns:
- Task ID
- Task Name
- Method (FL/MPC/TEE/Sandbox)
- Status (pending/running/completed/failed/cancelled)
- Created At
- Actions (view/cancel)

#### Scenario: Task Pagination
Given there are more than 10 tasks
When the user navigates to the list page
Then show pagination controls
And default to 10 items per page

#### Scenario: Task Filtering
Given the user is viewing task list
When they select filters (status, method, date range)
Then the list should update to show filtered results

#### Scenario: Task Sorting
Given the user is viewing task list
When they click column headers
Then sort tasks by that column (ascending/descending)

---

### Requirement: Create Compute Task Form
**Priority**: P0
**Component**: Frontend

#### Scenario: Display Create Form
Given the user clicks "New Task" button
When they navigate to /dashboard/compute/new
Then display a form with fields:
- Task Name (required, text)
- Method (required, select: FL/MPC/TEE/Sandbox)
- Description (optional, textarea)
- Algorithm-specific configuration (dynamic based on method)

#### Scenario: FL Task Configuration
Given the user selects "FL" method
When the form renders
Then show additional fields:
- Algorithm Type (FedAvg/FedProx/SCAFFOLD)
- Model Type (CNN/RNN/Transformer/Custom)
- Dataset Configuration (JSON editor)
- Training Parameters (rounds, clients, learning rate)
- Aggregation Configuration

#### Scenario: Form Validation
Given the user submits the form
When required fields are empty
Then show validation errors
And prevent form submission

#### Scenario: Submit Task
Given the form is valid
When the user clicks "Submit"
Then call API to create task
And redirect to task detail page
And show success message

---

### Requirement: Task Detail Page
**Priority**: P0
**Component**: Frontend

#### Scenario: Display Task Details
Given the user navigates to /dashboard/compute/:id
When the page loads
Then display:
- Task basic information (name, method, status, description)
- Progress bar showing completion percentage
- Timeline of status changes
- Current stage information

#### Scenario: Real-time Status Updates
Given the user is viewing a running task
When the task status changes on server
Then update the UI in real-time via WebSocket
And show notification for significant changes

#### Scenario: Cancel Task
Given the user is viewing a running task
When they click "Cancel" button
And confirm the action
Then send cancel request to API
And update UI to show cancellation in progress

#### Scenario: View Task Logs
Given the user is viewing a task
When they click "View Logs" button
Then show a modal/panel with task execution logs
And support filtering/searching logs

---

### Requirement: Task Result Page
**Priority**: P0
**Component**: Frontend

#### Scenario: Display Results
Given a task has completed successfully
When the user navigates to /dashboard/compute/:id/result
Then display:
- Summary metrics (accuracy, loss, training time)
- Charts showing training progress
- Model download link
- Detailed results table

#### Scenario: Training Metrics Charts
Given the task result contains metrics
When the result page loads
Then render charts:
- Loss over rounds (line chart)
- Accuracy over rounds (line chart)
- Client participation (bar chart)

#### Scenario: Export Results
Given the user is viewing results
When they click "Export" button
Then download results as JSON/CSV

---

### Requirement: WebSocket Real-time Updates
**Priority**: P1
**Component**: Frontend

#### Scenario: Connect to WebSocket
Given the user is on a task-related page
When the page loads
Then establish WebSocket connection
And subscribe to task status updates

#### Scenario: Handle Connection Loss
Given the WebSocket connection is lost
When the connection drops
Then show connection status indicator
And attempt to reconnect every 5 seconds

#### Scenario: Receive Status Updates
Given the WebSocket is connected
When a task status update is received
Then update the relevant component
And show toast notification if significant

---

## Target Files

```
apps/web/src/app/(dashboard)/compute/
├── page.tsx                      # Task list page
├── new/
│   └── page.tsx                  # Create task page
├── [id]/
│   ├── page.tsx                  # Task detail page
│   └── result/
│       └── page.tsx              # Task result page

apps/web/src/components/compute/
├── task-list-table.tsx           # Task list table
├── task-create-form.tsx          # Task creation form
├── task-status-badge.tsx         # Status badge component
├── task-detail-card.tsx          # Task detail display
├── task-result-viewer.tsx        # Results viewer
├── task-progress-bar.tsx         # Progress indicator
├── task-filter-panel.tsx         # Filter controls
├── task-action-menu.tsx          # Action dropdown
├── fl-algorithm-selector.tsx     # FL algorithm selector
└── fl-config-form.tsx            # FL configuration form

apps/web/src/hooks/
├── use-compute-tasks.ts          # Task list management
├── use-compute-task.ts           # Single task management
├── use-task-websocket.ts         # WebSocket connection
├── use-task-submission.ts        # Task submission flow
├── use-task-result.ts            # Result fetching
└── use-flower-servers.ts         # Server list

apps/web/src/api/
├── compute-task.api.ts           # Task API client
├── flower.api.ts                 # Flower API client
└── websocket.ts                  # WebSocket client

apps/web/src/types/
├── compute-task.types.ts         # Task types
├── flower.types.ts               # Flower types
├── task-status.types.ts          # Status enums
└── task-result.types.ts          # Result types
```

## Component Specifications

### TaskListTable
```typescript
interface TaskListTableProps {
  tasks: ComputeTask[];
  loading: boolean;
  pagination: PaginationConfig;
  onPageChange: (page: number) => void;
  onFilterChange: (filters: TaskFilters) => void;
  onSortChange: (sort: SortConfig) => void;
}
```

### TaskCreateForm
```typescript
interface TaskCreateFormProps {
  onSubmit: (data: CreateTaskData) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}

interface CreateTaskData {
  taskName: string;
  method: 'fl' | 'mpc' | 'tee' | 'sandbox';
  description?: string;
  algorithmConfig?: FLAlgorithmConfig | MPCConfig | TEEConfig;
}
```

### TaskDetailCard
```typescript
interface TaskDetailCardProps {
  task: ComputeTask;
  onCancel: () => Promise<void>;
  onRefresh: () => void;
}
```

### TaskResultViewer
```typescript
interface TaskResultViewerProps {
  result: TaskResult;
  onExport: (format: 'json' | 'csv') => void;
}
```

## API Integration

```typescript
// compute-task.api.ts
export const computeTaskApi = {
  getTasks: (params: QueryParams) => 
    api.get<PaginatedResult<ComputeTask>>('/compute-tasks', { params }),
  
  getTask: (id: string) => 
    api.get<ComputeTask>(`/compute-tasks/${id}`),
  
  createTask: (data: CreateTaskData) => 
    api.post<ComputeTask>('/compute-tasks', data),
  
  cancelTask: (id: string) => 
    api.post<void>(`/compute-tasks/${id}/cancel`),
  
  getResult: (id: string) => 
    api.get<TaskResult>(`/compute-tasks/${id}/result`),
};

// flower.api.ts
export const flowerApi = {
  getServers: () => 
    api.get<FlowerServer[]>('/flower/servers'),
  
  getHealth: (serverId: string) => 
    api.get<HealthStatus>(`/flower/health?serverId=${serverId}`),
  
  submitFLTask: (data: FLTaskData) => 
    api.post<FLTaskResponse>('/flower/submit', data),
};
```

## State Management

```typescript
// useComputeTasks hook
const useComputeTasks = () => {
  const [tasks, setTasks] = useState<ComputeTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<PaginationConfig>();
  const [filters, setFilters] = useState<TaskFilters>();
  
  const fetchTasks = async () => { ... };
  const createTask = async (data: CreateTaskData) => { ... };
  const cancelTask = async (id: string) => { ... };
  
  return { tasks, loading, pagination, filters, fetchTasks, createTask, cancelTask };
};

// useTaskWebSocket hook
const useTaskWebSocket = (taskId?: string) => {
  const [status, setStatus] = useState<TaskStatus>();
  const [progress, setProgress] = useState<number>(0);
  const [connected, setConnected] = useState(false);
  
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    // ... connection handling
    return () => ws.close();
  }, [taskId]);
  
  return { status, progress, connected };
};
```

## Routes

```typescript
// app/(dashboard)/compute/page.tsx
export default function ComputeTasksPage() {
  return (
    <div>
      <PageHeader title="计算任务" action={<NewTaskButton />} />
      <TaskFilterPanel />
      <TaskListTable />
    </div>
  );
}

// app/(dashboard)/compute/new/page.tsx
export default function CreateTaskPage() {
  return (
    <div>
      <PageHeader title="新建计算任务" backButton />
      <TaskCreateForm />
    </div>
  );
}

// app/(dashboard)/compute/[id]/page.tsx
export default function TaskDetailPage({ params }: { params: { id: string } }) {
  const { task, loading } = useComputeTask(params.id);
  const { status, progress } = useTaskWebSocket(params.id);
  
  return (
    <div>
      <TaskDetailCard task={task} status={status} progress={progress} />
      <TaskTimeline logs={task.logs} />
    </div>
  );
}
```

## UI/UX Specifications

### Status Badge Colors
- pending: gray
- running: blue (with pulse animation)
- completed: green
- failed: red
- cancelled: yellow

### Progress Bar
- Show percentage text
- Color based on status
- Animated transitions

### Loading States
- Skeleton loaders for table
- Spinners for buttons
- Progress indicators for long operations

### Error Handling
- Toast notifications for errors
- Inline validation messages
- Retry buttons for failed operations

## Responsive Design

```typescript
// Breakpoints
sm: 640px   // Mobile
md: 768px   // Tablet
lg: 1024px  // Desktop
xl: 1280px  // Large desktop

// Table behavior
- sm: Card layout
- md+: Table layout with horizontal scroll

// Form behavior
- sm: Single column
- md+: Two columns for algorithm config
```

## Testing

```typescript
// Component tests
- task-list-table.test.tsx
- task-create-form.test.tsx
- task-detail-card.test.tsx

// Hook tests
- use-compute-tasks.test.ts
- use-task-websocket.test.ts

// E2E tests
- compute-tasks.spec.ts
```

## Acceptance Criteria

1. **Functionality**
   - [ ] Can view list of compute tasks with pagination
   - [ ] Can filter and sort tasks
   - [ ] Can create new tasks with all methods
   - [ ] Can view task details with real-time updates
   - [ ] Can cancel running tasks
   - [ ] Can view and export results

2. **Performance**
   - [ ] Page load < 2 seconds
   - [ ] Table renders smoothly with 100+ rows
   - [ ] WebSocket updates < 100ms latency
   - [ ] Form submission < 1 second

3. **UX**
   - [ ] Intuitive navigation
   - [ ] Clear status indicators
   - [ ] Helpful error messages
   - [ ] Responsive on all devices

4. **Accessibility**
   - [ ] ARIA labels on interactive elements
   - [ ] Keyboard navigation support
   - [ ] Screen reader compatible
