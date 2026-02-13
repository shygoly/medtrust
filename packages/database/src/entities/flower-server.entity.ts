import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum FlowerServerStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  UNREACHABLE = 'unreachable',
  MAINTENANCE = 'maintenance',
}

/**
 * Flower Server Entity
 * Stores configuration and health status of Flower servers
 */
@Entity('flower_servers')
@Index(['status'])
@Index(['is_active'])
export class FlowerServer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true })
  name: string;

  @Column({ length: 255, name: 'server_url' })
  serverUrl: string;

  @Column({ length: 255, nullable: true, name: 'api_key' })
  apiKey: string;

  @Column({
    type: 'simple-enum',
    enum: FlowerServerStatus,
    default: FlowerServerStatus.UNREACHABLE,
  })
  status: FlowerServerStatus;

  @Column({ default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'int', default: 0, name: 'active_tasks' })
  activeTasks: number;

  @Column({ type: 'int', default: 0, name: 'queued_tasks' })
  queuedTasks: number;

  @Column({ type: 'int', default: 0, name: 'connected_clients' })
  connectedClients: number;

  @Column({ length: 50, nullable: true })
  version: string;

  @Column({ type: 'int', nullable: true, name: 'uptime_seconds' })
  uptimeSeconds: number;

  @Column({ type: 'simple-json', nullable: true, name: 'supported_algorithms' })
  supportedAlgorithms: string[];

  @Column({ type: 'int', default: 30000, name: 'health_check_interval' })
  healthCheckInterval: number;

  @Column({ type: 'int', default: 30000, name: 'request_timeout' })
  requestTimeout: number;

  @Column({ type: 'int', default: 3, name: 'max_retries' })
  maxRetries: number;

  @Column({ type: 'int', default: 10, name: 'max_connections' })
  maxConnections: number;

  @Column({ nullable: true, name: 'last_health_check' })
  lastHealthCheck: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
