import { maskPhone, maskIdCard, maskName, maskEmail } from './masking.utils';

describe('Masking Utils', () => {
  describe('maskPhone', () => {
    it('should mask 11-digit Chinese phone number', () => {
      expect(maskPhone('13812345678')).toBe('138****5678');
    });

    it('should mask phone with non-digit characters', () => {
      expect(maskPhone('138-1234-5678')).toBe('138****5678');
      expect(maskPhone('+86 138 1234 5678')).toBe('138****5678');
    });

    it('should handle shorter phone numbers', () => {
      const result = maskPhone('1234567');
      expect(result).toContain('*');
      expect(result?.length).toBe(7);
    });

    it('should return null for null input', () => {
      expect(maskPhone(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(maskPhone(undefined)).toBeNull();
    });

    it('should return empty string for empty input', () => {
      expect(maskPhone('')).toBe('');
    });
  });

  describe('maskIdCard', () => {
    it('should mask 18-digit ID card', () => {
      expect(maskIdCard('110101199001011234')).toBe('110101********1234');
    });

    it('should mask 15-digit ID card', () => {
      expect(maskIdCard('110101900101123')).toBe('110101*****0123');
    });

    it('should handle ID card with spaces', () => {
      expect(maskIdCard('110101 1990 0101 1234')).toBe('110101********1234');
    });

    it('should handle longer ID cards', () => {
      const result = maskIdCard('12345678901234567890');
      expect(result).toContain('123456');
      expect(result).toContain('7890');
      expect(result).toContain('*');
    });

    it('should return null for null input', () => {
      expect(maskIdCard(null)).toBeNull();
    });

    it('should return empty string for empty input', () => {
      expect(maskIdCard('')).toBe('');
    });
  });

  describe('maskName', () => {
    it('should mask Chinese single character name', () => {
      expect(maskName('张')).toBe('张');
    });

    it('should mask Chinese two character name', () => {
      expect(maskName('张三')).toBe('张*');
    });

    it('should mask Chinese three character name', () => {
      expect(maskName('张三丰')).toBe('张**');
    });

    it('should mask English first and last name', () => {
      const result = maskName('John Smith');
      expect(result).toContain('J');
      expect(result).toContain('S');
      expect(result).toContain('*');
    });

    it('should mask single English name', () => {
      expect(maskName('John')).toBe('J**n');
    });

    it('should mask short English name', () => {
      expect(maskName('Li')).toBe('L*');
    });

    it('should return null for null input', () => {
      expect(maskName(null)).toBeNull();
    });

    it('should return empty string for empty input', () => {
      expect(maskName('')).toBe('');
    });

    it('should handle names with extra spaces', () => {
      const result = maskName('  John  Smith  ');
      expect(result).toBeTruthy();
    });
  });

  describe('maskEmail', () => {
    it('should mask email with standard format', () => {
      expect(maskEmail('zhangsan@example.com')).toBe('zh****an@example.com');
    });

    it('should mask short email local part', () => {
      expect(maskEmail('ab@example.com')).toBe('a*@example.com');
    });

    it('should mask single character local part', () => {
      expect(maskEmail('a@example.com')).toBe('a*@example.com');
    });

    it('should handle long email addresses', () => {
      const result = maskEmail('verylongemailaddress@example.com');
      expect(result).toContain('@example.com');
      expect(result).toContain('*');
      expect(result?.startsWith('ve')).toBe(true);
    });

    it('should return original if no @ symbol', () => {
      expect(maskEmail('notanemail')).toBe('notanemail');
    });

    it('should return null for null input', () => {
      expect(maskEmail(null)).toBeNull();
    });

    it('should return empty string for empty input', () => {
      expect(maskEmail('')).toBe('');
    });
  });
});
