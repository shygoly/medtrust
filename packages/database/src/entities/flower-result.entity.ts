import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { FlowerTask } from './flower-task.entity';

/**
 * Flower Result Entity
 * Stores results and metrics from completed FL tasks
 */
@Entity('flower_results')
@Index(['taskId'])
@Index(['createdAt'])
export class FlowerResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'task_id' })
  taskId: number;

  @ManyToOne(() => FlowerTask)
  @JoinColumn({ name: 'task_id' })
  task: FlowerTask;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true, name: 'final_loss' })
  finalLoss: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true, name: 'final_accuracy' })
  finalAccuracy: number;

  @Column({ type: 'int', name: 'rounds_completed' })
  roundsCompleted: number;

  @Column({ type: 'simple-json', name: 'client_metrics' })
  clientMetrics: Array<{
    clientId: string;
    metrics: Record<string, number>;
  }>;

  @Column({ type: 'simple-json', nullable: true, name: 'global_metrics' })
  globalMetrics: Record<string, number>;

  @Column({ type: 'text', nullable: true, name: 'model_url' })
  modelUrl: string;

  @Column({ type: 'text', nullable: true, name: 'checkpoint_url' })
  checkpointUrl: string;

  @Column({ type: 'bigint', nullable: true, name: 'model_size' })
  modelSize: number;

  @Column({ type: 'text', nullable: true, name: 'storage_path' })
  storagePath: string;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
