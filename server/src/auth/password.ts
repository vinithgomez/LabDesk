import bcrypt from "bcrypt";

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export function createPasswordHasher(rounds: number): PasswordHasher {
  return {
    hash: (plain) => bcrypt.hash(plain, rounds),
    verify: (plain, hash) => bcrypt.compare(plain, hash),
  };
}
