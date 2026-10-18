import { validateToolParameters } from '../src/tool';
import type { ToolParameters } from '../src/tool';

describe('Tool parameter validation', () => {
  describe('Basic type validation', () => {
    it('should validate string type', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          message: { type: 'string' }
        },
        required: ['message']
      };

      const errors = validateToolParameters({ message: 'hello' }, schema);
      expect(errors).toEqual([]);
    });

    it('should reject invalid string type', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          message: { type: 'string' }
        }
      };

      const errors = validateToolParameters({ message: 123 }, schema);
      expect(errors).toContain('message: expected string, got number');
    });

    it('should validate number type', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          count: { type: 'number' }
        }
      };

      const errors = validateToolParameters({ count: 42 }, schema);
      expect(errors).toEqual([]);
    });

    it('should validate array type', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      };

      const errors = validateToolParameters({ items: ['a', 'b'] }, schema);
      expect(errors).toEqual([]);
    });
  });

  describe('Required fields', () => {
    it('should detect missing required field', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        },
        required: ['name']
      };

      const errors = validateToolParameters({}, schema);
      expect(errors).toContain('Missing required parameter: name');
    });

    it('should pass with all required fields', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        },
        required: ['name', 'age']
      };

      const errors = validateToolParameters({ name: 'Alice', age: 30 }, schema);
      expect(errors).toEqual([]);
    });
  });

  describe('Enum validation', () => {
    it('should validate enum values', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'inactive']
          }
        }
      };

      const errors = validateToolParameters({ status: 'active' }, schema);
      expect(errors).toEqual([]);
    });

    it('should reject invalid enum value', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'inactive']
          }
        }
      };

      const errors = validateToolParameters({ status: 'pending' }, schema);
      expect(errors).toContain('status: must be one of [active, inactive]');
    });
  });

  describe('Number range validation', () => {
    it('should validate minimum', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          age: {
            type: 'number',
            minimum: 0
          }
        }
      };

      expect(validateToolParameters({ age: 10 }, schema)).toEqual([]);
      expect(validateToolParameters({ age: -1 }, schema)).toContain('age: must be >= 0');
    });

    it('should validate maximum', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          score: {
            type: 'number',
            maximum: 100
          }
        }
      };

      expect(validateToolParameters({ score: 50 }, schema)).toEqual([]);
      expect(validateToolParameters({ score: 150 }, schema)).toContain('score: must be <= 100');
    });
  });

  describe('Nested validation', () => {
    it('should validate array items', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      };

      expect(validateToolParameters({ tags: ['a', 'b'] }, schema)).toEqual([]);
      expect(validateToolParameters({ tags: ['a', 123] }, schema)).toContain('tags[1]: expected string, got number');
    });

    it('should validate nested objects', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' }
            }
          }
        }
      };

      const errors = validateToolParameters({
        user: { name: 'Alice', age: 'invalid' }
      }, schema);

      expect(errors).toContain('user.age: expected number, got string');
    });
  });

  describe('Edge cases', () => {
    it('should reject non-object parameters', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {}
      };

      const errors = validateToolParameters('invalid', schema);
      expect(errors).toContain('Parameters must be an object');
    });

    it('should reject null parameters', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {}
      };

      const errors = validateToolParameters(null, schema);
      expect(errors).toContain('Parameters must be an object');
    });

    it('should detect unknown parameters', () => {
      const schema: ToolParameters = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      };

      const errors = validateToolParameters({ name: 'Alice', unknown: 'field' }, schema);
      expect(errors).toContain('Unknown parameter: unknown');
    });
  });
});
