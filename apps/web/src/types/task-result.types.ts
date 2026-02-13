import type { TaskMetrics, MetricPoint, ClientParticipation, TaskResult } from './compute-task.types';

// Re-export types from compute-task.types
export type { MetricPoint, ClientParticipation, TaskResult } from './compute-task.types';

// 导出格式
export type ExportFormat = 'json' | 'csv';

// 图表配置
export interface ChartConfig {
  width?: number;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  colors?: string[];
}

// 损失曲线配置
export interface LossChartConfig extends ChartConfig {
  showTrendLine?: boolean;
  yAxisMin?: number;
  yAxisMax?: number;
}

// 准确率曲线配置
export interface AccuracyChartConfig extends ChartConfig {
  showTargetLine?: boolean;
  targetAccuracy?: number;
}

// 客户端参与图表配置
export interface ParticipationChartConfig extends ChartConfig {
  showPercentage?: boolean;
  sortByParticipation?: boolean;
}

// 结果导出选项
export interface ExportOptions {
  format: ExportFormat;
  includeMetrics?: boolean;
  includeModel?: boolean;
  includeLogs?: boolean;
}

// 结果比较数据
export interface ResultComparison {
  taskIds: string[];
  metrics: string[];
  charts: {
    lossComparison?: MetricPoint[][];
    accuracyComparison?: MetricPoint[][];
    summaryTable?: ComparisonRow[];
  };
}

// 比较表格行
export interface ComparisonRow {
  metric: string;
  values: Record<string, number | string>;
}

// 模型信息
export interface ModelInfo {
  name: string;
  version: string;
  size: number;
  format: string;
  checksum: string;
  downloadUrl: string;
  createdAt: string;
}

// 结果摘要卡片数据
export interface ResultSummaryCard {
  title: string;
  value: string | number;
  unit?: string;
  change?: number;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon?: string;
}

// 默认导出函数
export function exportResults(result: TaskResult, options: ExportOptions): Blob {
  if (options.format === 'csv') {
    return exportToCSV(result, options);
  }
  return exportToJSON(result, options);
}

function exportToCSV(result: any, options: ExportOptions): Blob {
  const rows: string[] = [];
  
  // Header
  rows.push('Task ID,Status,Completed At');
  rows.push(`${result.taskId},${result.status},${result.completedAt}`);
  rows.push('');
  
  // Summary
  if (options.includeMetrics && result.summary) {
    rows.push('Metric,Value');
    if (result.summary.accuracy !== undefined) {
      rows.push(`Accuracy,${result.summary.accuracy}`);
    }
    if (result.summary.loss !== undefined) {
      rows.push(`Loss,${result.summary.loss}`);
    }
    if (result.summary.trainingTime !== undefined) {
      rows.push(`Training Time,${result.summary.trainingTime}`);
    }
    rows.push('');
  }
  
  // Metrics
  if (options.includeMetrics && result.metrics) {
    // Loss over rounds
    if (result.metrics.lossOverRounds.length > 0) {
      rows.push('Round,Loss');
      result.metrics.lossOverRounds.forEach((point: MetricPoint) => {
        rows.push(`${point.round},${point.value}`);
      });
      rows.push('');
    }
    
    // Accuracy over rounds
    if (result.metrics.accuracyOverRounds.length > 0) {
      rows.push('Round,Accuracy');
      result.metrics.accuracyOverRounds.forEach((point: MetricPoint) => {
        rows.push(`${point.round},${point.value}`);
      });
    }
  }
  
  const csv = rows.join('\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}

function exportToJSON(result: any, options: ExportOptions): Blob {
  const exportData: Record<string, any> = {
    taskId: result.taskId,
    status: result.status,
    completedAt: result.completedAt,
  };
  
  if (options.includeMetrics) {
    exportData.summary = result.summary;
    exportData.metrics = result.metrics;
  }
  
  if (options.includeModel && result.modelDownloadUrl) {
    exportData.model = {
      downloadUrl: result.modelDownloadUrl,
    };
  }
  
  return new Blob([JSON.stringify(exportData, null, 2)], { 
    type: 'application/json' 
  });
}
