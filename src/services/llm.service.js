/**
 * Builds the prompt that grounds the LLM in retrieved context, and calls
 * Groq for generation. Phase 1 = non-streaming; streaming is a later
 * phase that swaps this for a server-sent-events response.
 */

function buildPrompt(question, retrievedChunks) {
  if (!retrievedChunks.length) {
    return [
      {
        role: 'system',
        content:
          'You are a documentation assistant. No relevant context was found for this question. ' +
          'Tell the user you could not find relevant information in the knowledge base, ' +
          'do not attempt to answer from general knowledge.',
      },
      { role: 'user', content: question },
    ];
  }

  const context = retrievedChunks
    .map((chunk, i) => `[Source ${i + 1}]\n${chunk.text}`)
    .join('\n\n');

  return [
    {
      role: 'system',
      content:
        'You are a documentation assistant. Answer the user question using ONLY the ' +
        'provided context below. If the context does not contain enough information ' +
        'to answer confidently, say so explicitly instead of guessing. Cite which ' +
        'Source number(s) you used.\n\nContext:\n' +
        context,
    },
    { role: 'user', content: question },
  ];
}

async function generateAnswer(question, retrievedChunks) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set');
  }

  const messages = buildPrompt(question, retrievedChunks);

  const response = await fetch(process.env.GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      messages,
      temperature: 0.2, // low temperature: we want grounded, consistent answers, not creativity
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();

  return {
    answer: data.choices?.[0]?.message?.content || '',
    usage: data.usage || null, // token counts — this is what cost-tracking (later phase) will read
  };
}


async function streamAnswer(question, retrievedChunks, onToken) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set');
  }
 
  const messages = buildPrompt(question, retrievedChunks);
 
  const response = await fetch(process.env.GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      messages,
      temperature: 0.2,
      stream: true,
      stream_options: { include_usage: true }, // Groq sends a final usage-only chunk when this is set
    }),
  });
 
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errBody}`);
  }
 
  let fullAnswer = '';
  let usage = null;
  let buffer = '';
 
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString('utf-8');
 
    // Groq's SSE stream sends complete events separated by double newlines
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep any incomplete trailing line for the next chunk
 
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
 
      if (payload === '[DONE]') continue;
 
      try {
        const parsed = JSON.parse(payload);
        const tokenText = parsed.choices?.[0]?.delta?.content;
        if (tokenText) {
          fullAnswer += tokenText;
          onToken(tokenText);
        }
        if (parsed.x_groq?.usage) {
          usage = parsed.x_groq.usage;
        } else if (parsed.usage) {
          usage = parsed.usage;
        }
      } catch {
        // an incomplete/malformed JSON fragment — skip, next chunk will
        // bring the rest and the buffer logic above handles reassembly
      }
    }
  }
 
  return { answer: fullAnswer, usage };
}

module.exports = { buildPrompt, generateAnswer, streamAnswer };