import { deliverableObjectKey, tigrisConfigured } from './lora-deliverable-storage';

describe('lora-deliverable-storage', () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it('builds stable object keys under deliverables prefix', () => {
    expect(deliverableObjectKey('fed-task-1')).toBe('deliverables/fed-task-1.enc.json');
    expect(deliverableObjectKey('fed/task#2', 'lora/')).toBe('lora/fed_task_2.enc.json');
  });

  it('detects Tigris when bucket and credentials are set', () => {
    delete process.env.BUCKET_NAME;
    expect(tigrisConfigured()).toBe(false);

    process.env.BUCKET_NAME = 'demo-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'tid_test';
    process.env.AWS_SECRET_ACCESS_KEY = 'tsec_test';
    expect(tigrisConfigured()).toBe(true);
  });
});
