export function maskPhone(phone: string | null | undefined): string | null {
  if (phone === "") return "";
  if (!phone) return null;

  // Strip non-digits, then remove common Chinese country code (+86) if present
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("86") && cleaned.length > 11) {
    cleaned = cleaned.slice(2);
  }

  if (cleaned.length === 11) {
    return `${cleaned.substring(0, 3)}****${cleaned.substring(7)}`;
  }

  if (cleaned.length >= 7) {
    const visibleStart = Math.min(3, Math.floor(cleaned.length / 3));
    const visibleEnd = Math.min(4, Math.floor(cleaned.length / 3));
    const maskedLength = cleaned.length - visibleStart - visibleEnd;
    return `${cleaned.substring(0, visibleStart)}${"*".repeat(maskedLength)}${cleaned.substring(cleaned.length - visibleEnd)}`;
  }

  return phone;
}

export function maskIdCard(idCard: string | null | undefined): string | null {
  if (idCard === "") return "";
  if (!idCard) return null;

  const cleaned = idCard.replace(/\s/g, "");

  if (cleaned.length === 18) {
    return `${cleaned.substring(0, 6)}********${cleaned.substring(14)}`;
  }

  if (cleaned.length === 15) {
    return `${cleaned.substring(0, 6)}*****${cleaned.substring(11)}`;
  }

  if (cleaned.length > 10) {
    return `${cleaned.substring(0, 6)}${"*".repeat(cleaned.length - 10)}${cleaned.substring(cleaned.length - 4)}`;
  }

  return idCard;
}

export function maskName(name: string | null | undefined): string | null {
  if (name === "") return "";
  if (!name) return null;

  const trimmed = name.trim();

  if (/[\u4e00-\u9fa5]/.test(trimmed)) {
    if (trimmed.length === 1) {
      return trimmed;
    }
    return `${trimmed.charAt(0)}${"*".repeat(trimmed.length - 1)}`;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    return `${parts[0].charAt(0)}${"*".repeat(parts[0].length - 1)} ${parts[parts.length - 1].charAt(0)}.`;
  }

  if (trimmed.length <= 2) {
    return `${trimmed.charAt(0)}*`;
  }

  return `${trimmed.charAt(0)}${"*".repeat(trimmed.length - 2)}${trimmed.charAt(trimmed.length - 1)}`;
}

export function maskEmail(email: string | null | undefined): string | null {
  if (email === "") return "";
  if (!email) return null;

  const atIndex = email.indexOf("@");
  if (atIndex === -1) {
    return email;
  }

  const localPart = email.substring(0, atIndex);
  const domain = email.substring(atIndex);

  if (localPart.length <= 2) {
    return `${localPart.charAt(0)}*${domain}`;
  }

  const visibleStart = Math.min(2, Math.floor(localPart.length / 3));
  const visibleEnd = Math.min(2, Math.floor(localPart.length / 3));
  const maskedLength = localPart.length - visibleStart - visibleEnd;

  return `${localPart.substring(0, visibleStart)}${"*".repeat(maskedLength)}${localPart.substring(localPart.length - visibleEnd)}${domain}`;
}
