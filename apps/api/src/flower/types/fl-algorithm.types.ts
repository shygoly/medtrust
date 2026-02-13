/**
 * FL Algorithm Types
 * Type definitions for federated learning algorithms
 */

import { FLAlgorithmType, FLModelType, FLTaskType } from './flower.types';

export interface FLAlgorithmConfig {
  type: FLAlgorithmType;
  name: string;
  description: string;
  supportedModels: FLModelType[];
  supportedTaskTypes: FLTaskType[];
  parameters: FLAlgorithmParameter[];
}

export interface FLAlgorithmParameter {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'enum';
  description: string;
  required: boolean;
  defaultValue?: any;
  min?: number;
  max?: number;
  options?: string[];
}

export const SUPPORTED_ALGORITHMS: FLAlgorithmConfig[] = [
  {
    type: FLAlgorithmType.FEDAVG,
    name: 'FedAvg',
    description: 'Federated Averaging - Classic federated learning aggregation algorithm',
    supportedModels: [
      FLModelType.LOGISTIC_REGRESSION,
      FLModelType.RANDOM_FOREST,
      FLModelType.NEURAL_NETWORK,
      FLModelType.CNN,
      FLModelType.RNN,
    ],
    supportedTaskTypes: [
      FLTaskType.CLASSIFICATION,
      FLTaskType.REGRESSION,
    ],
    parameters: [],
  },
  {
    type: FLAlgorithmType.FEDPROX,
    name: 'FedProx',
    description: 'Federated Proximal - Handles heterogeneous data distributions',
    supportedModels: [
      FLModelType.LOGISTIC_REGRESSION,
      FLModelType.NEURAL_NETWORK,
      FLModelType.CNN,
    ],
    supportedTaskTypes: [
      FLTaskType.CLASSIFICATION,
      FLTaskType.REGRESSION,
    ],
    parameters: [
      {
        name: 'proximalMu',
        type: 'number',
        description: 'Proximal term coefficient for regularization',
        required: false,
        defaultValue: 0.01,
        min: 0,
        max: 1,
      },
    ],
  },
  {
    type: FLAlgorithmType.FEDNOVA,
    name: 'FedNova',
    description: 'Federated Normalized Averaging - Handles heterogeneous client participation',
    supportedModels: [
      FLModelType.LOGISTIC_REGRESSION,
      FLModelType.NEURAL_NETWORK,
      FLModelType.CNN,
    ],
    supportedTaskTypes: [
      FLTaskType.CLASSIFICATION,
      FLTaskType.REGRESSION,
    ],
    parameters: [],
  },
];

export interface FLClientConfig {
  clientId: string;
  dataAssetId: string;
  nodeUrl: string;
  weight?: number;
}

export interface FLTrainingMetrics {
  round: number;
  loss: number;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  auc?: number;
  timestamp: string;
}

export interface FLGlobalMetrics {
  currentRound: number;
  totalRounds: number;
  aggregatedLoss: number;
  aggregatedAccuracy?: number;
  clientParticipation: number;
  trainingTime: number;
}
