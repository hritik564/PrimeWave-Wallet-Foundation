export const confirmationPositions = [4, 9, 12] as const;

export function confirmsBackup(phrase: string, answers: readonly string[]): boolean {
  const words = phrase.split(' ');
  return answers.length === confirmationPositions.length &&
    confirmationPositions.every((position, index) => words[position - 1] === answers[index].trim().toLowerCase());
}
