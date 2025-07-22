import inquirer from 'inquirer';

// Graceful shutdown handling
export function setupGracefulShutdown() {
  process.on('SIGINT', () => {
    console.log('\n\n👋 Goodbye! \n');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\n👋 Goodbye! \n');
    process.exit(0);
  });
}

// Wrapper for inquirer prompts with error handling
export async function safePrompt<T = any>(questions: any): Promise<T | null> {
  try {
    // Ensure clean terminal state before prompting
    process.stdout.write('\u001b[?25h'); // Show cursor
    process.stderr.write(''); // Flush stderr
    
    return await inquirer.prompt(questions) as T;
  } catch (error: any) {
    if (error.name === 'ExitPromptError' || error.isTTYError) {
      console.log('\n\n👋 Goodbye! Exiting gracefully...\n');
      process.exit(0);
    }
    throw error;
  }
}
