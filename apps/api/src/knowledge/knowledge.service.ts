import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface CreateKnowledgeInput {
  title?: string;
  content: string;
  tags?: string[];
}

/** Gestión de la base de conocimiento de un proyecto (RAG v1). */
@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  list(projectId: string) {
    return this.prisma.client.knowledgeChunk.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(projectId: string, input: CreateKnowledgeInput) {
    return this.prisma.client.knowledgeChunk.create({
      data: {
        projectId,
        title: input.title?.trim() || null,
        content: input.content,
        tags: input.tags ?? [],
      },
    });
  }

  async remove(id: string) {
    const chunk = await this.prisma.client.knowledgeChunk.findUnique({ where: { id }, select: { id: true } });
    if (!chunk) throw new NotFoundException('Fragmento no encontrado.');
    await this.prisma.client.knowledgeChunk.delete({ where: { id } });
    return { ok: true };
  }
}
