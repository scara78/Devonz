import type { Message } from 'ai';
import { generateId } from './fileUtils';
import { detectProjectCommands, createCommandsMessage } from './projectCommands';
import { stageChange, acceptChange, type ChangeType } from '~/lib/stores/staging';
import { workbenchStore } from '~/lib/stores/workbench';

/**
 * Create chat messages from an imported folder.
 * Files are directly staged and auto-approved (user-initiated import).
 * No artifact XML is generated - uses agent tool flow instead.
 */
export const createChatFromFolder = async (
  files: File[],
  binaryFiles: string[],
  folderName: string,
): Promise<Message[]> => {
  const fileArtifacts = await Promise.all(
    files.map(async (file) => {
      return new Promise<{ content: string; path: string }>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
          const content = reader.result as string;
          const relativePath = file.webkitRelativePath.split('/').slice(1).join('/');
          resolve({
            content,
            path: relativePath,
          });
        };
        reader.onerror = reject;
        reader.readAsText(file);
      });
    }),
  );

  const commands = await detectProjectCommands(fileArtifacts);
  const commandsMessage = createCommandsMessage(commands);

  // Directly stage files using the staging store (agent mode approach)
  // Files are auto-approved since this is a user-initiated import
  const messageId = generateId();

  for (const file of fileArtifacts) {
    const stagedChange = stageChange({
      filePath: file.path,
      type: 'create' as ChangeType,
      originalContent: null,
      newContent: file.content,
      actionId: `import-${messageId}-${file.path}`,
      messageId: messageId,
      description: `Import: ${file.path}`,
    });

    // Auto-approve the staged file (user-initiated import)
    if (stagedChange && stagedChange.status === 'pending') {
      acceptChange(stagedChange.id);
    }
  }

  // Show workbench after importing files
  workbenchStore.showWorkbench.set(true);

  const binaryFilesMessage =
    binaryFiles.length > 0
      ? `\n\nSkipped ${binaryFiles.length} binary files:\n${binaryFiles.map((f) => `- ${f}`).join('\n')}`
      : '';

  // Create a clean message without artifact XML
  const filesMessage: Message = {
    role: 'assistant',
    content: `I've imported the contents of the "${folderName}" folder.${binaryFilesMessage}

**Files imported (${fileArtifacts.length}):**
${fileArtifacts.map((file) => `- \`${file.path}\``).join('\n')}

The files have been added to your project and are ready to use.`,
    id: messageId,
    createdAt: new Date(),
  };

  const userMessage: Message = {
    role: 'user',
    id: generateId(),
    content: `Import the "${folderName}" folder`,
    createdAt: new Date(),
  };

  const messages = [userMessage, filesMessage];

  if (commandsMessage) {
    messages.push({
      role: 'user',
      id: generateId(),
      content: 'Setup the codebase and Start the application',
    });
    messages.push(commandsMessage);
  }

  return messages;
};
