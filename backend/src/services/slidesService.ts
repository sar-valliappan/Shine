import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface SlideContent {
  title: string;
  bullets: string[];
  imagePrompt?: string;
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

const THEME_COLORS: RgbColor[] = [
  { red: 0.07, green: 0.13, blue: 0.28 }, // navy   (title / default)
  { red: 0.0,  green: 0.27, blue: 0.11 }, // forest green (strengths)
  { red: 0.45, green: 0.0,  blue: 0.0  }, // dark red     (weaknesses)
  { red: 0.0,  green: 0.22, blue: 0.47 }, // ocean blue   (opportunities)
  { red: 0.48, green: 0.22, blue: 0.0  }, // burnt orange (threats)
  { red: 0.18, green: 0.09, blue: 0.27 }, // deep purple
  { red: 0.0,  green: 0.25, blue: 0.35 }, // teal
];

function pickColor(index: number, prompt: string): RgbColor {
  const p = prompt.toLowerCase();
  if (index === 0) return THEME_COLORS[0];
  if (/strength/i.test(p))    return THEME_COLORS[1];
  if (/weakness/i.test(p))    return THEME_COLORS[2];
  if (/opportunit/i.test(p))  return THEME_COLORS[3];
  if (/threat/i.test(p))      return THEME_COLORS[4];
  return THEME_COLORS[index % THEME_COLORS.length];
}

async function generateSlideContent(
  prompt: string,
  isTitle: boolean,
  apiKey: string,
): Promise<SlideContent> {
  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel(
      { model: process.env.GEMINI_MODEL ?? 'gemma-3-27b-it' },
      { apiVersion: 'v1beta' },
    );

    const instruction = isTitle
      ? `Create a stunning title slide for: "${prompt}". Return ONLY valid JSON (no markdown fences):
{"title": "presentation title", "bullets": ["one compelling subtitle"], "imagePrompt": "highly detailed, descriptive image generation prompt related to the title (e.g. 'a fast cheetah running in the savanna sunset')"}`
      : `Create highly engaging slide content for: "${prompt}". Return ONLY valid JSON (no markdown fences):
{"title": "concise slide title (5-7 words)", "bullets": ["point 1", "point 2", "point 3", "point 4"], "imagePrompt": "highly detailed image generation prompt related to this specific slide"}
Each bullet must be under 12 words.`;

    const result = await model.generateContent(instruction);
    const raw = result.response.text().trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '');

    return JSON.parse(raw) as SlideContent;
  } catch {
    return { title: prompt.slice(0, 60), bullets: [] };
  }
}

function whiteText(objectId: string, fontSize: number, bold = false) {
  return {
    updateTextStyle: {
      objectId,
      style: {
        foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } },
        bold,
        fontSize: { magnitude: fontSize, unit: 'PT' },
      },
      textRange: { type: 'ALL' },
      fields: 'foregroundColor,bold,fontSize',
    },
  };
}

function setBackground(objectId: string, color: RgbColor) {
  return {
    updatePageProperties: {
      objectId,
      pageProperties: {
        pageBackgroundFill: { solidFill: { color: { rgbColor: color } } },
      },
      fields: 'pageBackgroundFill',
    },
  };
}

export async function createStyledPresentation(
  title: string,
  slidePrompts: string[],
  oauthClient: unknown,
  apiKey: string | undefined,
): Promise<{ presentationId: string; url: string; slideCount: number }> {
  const slidesApi = google.slides({ version: 'v1', auth: oauthClient as any });

  // Generate all slide content in parallel
  const contents: SlideContent[] = await Promise.all(
    slidePrompts.map((p, i) =>
      apiKey
        ? generateSlideContent(p, i === 0, apiKey)
        : Promise.resolve({ title: p, bullets: [] }),
    ),
  );

  // Create blank presentation
  const created = await slidesApi.presentations.create({ requestBody: { title } });
  const presentationId = created.data.presentationId!;

  // Fetch default first slide to find placeholder IDs
  const pres = await slidesApi.presentations.get({ presentationId });
  const defaultSlide = pres.data.slides?.[0];
  const defaultSlideId = defaultSlide?.objectId!;

  const titleEl = defaultSlide?.pageElements?.find(
    (el) =>
      el.shape?.placeholder?.type === 'CENTERED_TITLE' ||
      el.shape?.placeholder?.type === 'TITLE',
  );
  const subtitleEl = defaultSlide?.pageElements?.find(
    (el) =>
      el.shape?.placeholder?.type === 'SUBTITLE' ||
      el.shape?.placeholder?.type === 'BODY',
  );

  const requests: any[] = [];

  // --- First slide (title) ---
  if (titleEl?.objectId && contents[0].title) {
    requests.push(
      { insertText: { objectId: titleEl.objectId, text: contents[0].title, insertionIndex: 0 } },
      whiteText(titleEl.objectId, 44, true),
    );
  }
  if (subtitleEl?.objectId && (contents[0].bullets?.length || 0) > 0) {
    requests.push(
      {
        insertText: {
          objectId: subtitleEl.objectId,
          text: (contents[0].bullets || []).join('\n'),
          insertionIndex: 0,
        },
      },
      whiteText(subtitleEl.objectId, 24),
    );
  }
  if (contents[0].imagePrompt) {
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(contents[0].imagePrompt)}`;
    requests.push({
      createImage: {
        objectId: `title_img_${Date.now()}`,
        url: imageUrl,
        elementProperties: {
          pageObjectId: defaultSlideId,
          size: { width: { magnitude: 360, unit: 'PT' }, height: { magnitude: 405, unit: 'PT' } },
          transform: { scaleX: 1, scaleY: 1, translateX: 360, translateY: 0, unit: 'PT' }
        }
      }
    });
    if (titleEl?.objectId) {
      requests.push({ updatePageElementTransform: { objectId: titleEl.objectId, transform: { scaleX: 0.5, scaleY: 1, translateX: 0, translateY: 0, unit: 'PT' }, applyMode: 'RELATIVE' } });
    }
    if (subtitleEl?.objectId) {
      requests.push({ updatePageElementTransform: { objectId: subtitleEl.objectId, transform: { scaleX: 0.5, scaleY: 1, translateX: 0, translateY: 0, unit: 'PT' }, applyMode: 'RELATIVE' } });
    }
  }
  requests.push(setBackground(defaultSlideId, pickColor(0, slidePrompts[0])));

  // --- Remaining slides ---
  for (let i = 1; i < slidePrompts.length; i++) {
    const slideId  = `s_${Date.now()}_${i}`;
    const titleId  = `${slideId}_t`;
    const bodyId   = `${slideId}_b`;
    const content  = contents[i];

    requests.push({
      createSlide: {
        objectId: slideId,
        insertionIndex: i,
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId },
          { layoutPlaceholder: { type: 'BODY',  index: 0 }, objectId: bodyId  },
        ],
      },
    });

    if (content.title) {
      requests.push(
        { insertText: { objectId: titleId, text: content.title, insertionIndex: 0 } },
        whiteText(titleId, 36, true),
      );
    }

    if ((content.bullets?.length || 0) > 0) {
      requests.push(
        { insertText: { objectId: bodyId, text: (content.bullets || []).join('\n'), insertionIndex: 0 } },
        whiteText(bodyId, 20),
      );
    }

    if (content.imagePrompt) {
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(content.imagePrompt)}`;
      requests.push({
        createImage: {
          objectId: `${slideId}_img`,
          url: imageUrl,
          elementProperties: {
            pageObjectId: slideId,
            size: { width: { magnitude: 360, unit: 'PT' }, height: { magnitude: 405, unit: 'PT' } },
            transform: { scaleX: 1, scaleY: 1, translateX: 360, translateY: 0, unit: 'PT' }
          }
        }
      });
      requests.push({ updatePageElementTransform: { objectId: titleId, transform: { scaleX: 0.5, scaleY: 1, translateX: 0, translateY: 0, unit: 'PT' }, applyMode: 'RELATIVE' } });
      requests.push({ updatePageElementTransform: { objectId: bodyId, transform: { scaleX: 0.5, scaleY: 1, translateX: 0, translateY: 0, unit: 'PT' }, applyMode: 'RELATIVE' } });
    }

    requests.push(setBackground(slideId, pickColor(i, slidePrompts[i])));
  }

  await slidesApi.presentations.batchUpdate({ presentationId, requestBody: { requests } });

  return {
    presentationId,
    url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    slideCount: slidePrompts.length,
  };
}

export async function addSlide(
  presentationId: string,
  slidePrompt: string,
  oauthClient: unknown,
  apiKey: string | undefined,
): Promise<{ title: string }> {
  const slidesApi = google.slides({ version: 'v1', auth: oauthClient as any });

  const content = apiKey
    ? await generateSlideContent(slidePrompt, false, apiKey)
    : { title: slidePrompt, bullets: [] };

  const pres = await slidesApi.presentations.get({ presentationId });
  const slideCount = pres.data.slides?.length ?? 0;

  const slideId = `s_${Date.now()}_new`;
  const titleId = `${slideId}_t`;
  const bodyId  = `${slideId}_b`;

  const requests: any[] = [
    {
      createSlide: {
        objectId: slideId,
        insertionIndex: slideCount,
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId },
          { layoutPlaceholder: { type: 'BODY',  index: 0 }, objectId: bodyId  },
        ],
      },
    },

    setBackground(slideId, THEME_COLORS[slideCount % THEME_COLORS.length]),
  ];

  if (content.title) {
    requests.push(
      { insertText: { objectId: titleId, text: content.title, insertionIndex: 0 } },
      whiteText(titleId, 36, true),
    );
  }

  if ((content.bullets?.length || 0) > 0) {
    requests.push(
      { insertText: { objectId: bodyId, text: (content.bullets || []).join('\n'), insertionIndex: 0 } },
      whiteText(bodyId, 20),
    );
  }

  if (content.imagePrompt) {
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(content.imagePrompt)}`;
    requests.push({
      createImage: {
        objectId: `${slideId}_img`,
        url: imageUrl,
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: 360, unit: 'PT' }, height: { magnitude: 405, unit: 'PT' } },
          transform: { scaleX: 1, scaleY: 1, translateX: 360, translateY: 0, unit: 'PT' }
        }
      }
    });
    requests.push({ updatePageElementTransform: { objectId: titleId, transform: { scaleX: 0.5, scaleY: 1, translateX: 0, translateY: 0, unit: 'PT' }, applyMode: 'RELATIVE' } });
    requests.push({ updatePageElementTransform: { objectId: bodyId, transform: { scaleX: 0.5, scaleY: 1, translateX: 0, translateY: 0, unit: 'PT' }, applyMode: 'RELATIVE' } });
  }

  await slidesApi.presentations.batchUpdate({ presentationId, requestBody: { requests } });
  return { title: content.title };
}

export async function editSlide(
  presentationId: string,
  slideIndex: number,
  updates: { title?: string; body?: string },
  oauthClient: unknown,
): Promise<void> {
  const slidesApi = google.slides({ version: 'v1', auth: oauthClient as any });

  const pres = await slidesApi.presentations.get({ presentationId });
  const slide = pres.data.slides?.[slideIndex];
  if (!slide) throw new Error(`Slide ${slideIndex + 1} not found`);

  const titleEl = slide.pageElements?.find(
    (el) =>
      el.shape?.placeholder?.type === 'TITLE' ||
      el.shape?.placeholder?.type === 'CENTERED_TITLE',
  );
  const bodyEl = slide.pageElements?.find(
    (el) =>
      el.shape?.placeholder?.type === 'BODY' ||
      el.shape?.placeholder?.type === 'SUBTITLE',
  );

  const requests: any[] = [];

  if (updates.title && titleEl?.objectId) {
    requests.push(
      { deleteText: { objectId: titleEl.objectId, textRange: { type: 'ALL' } } },
      { insertText: { objectId: titleEl.objectId, text: updates.title, insertionIndex: 0 } },
      whiteText(titleEl.objectId, 36, true),
    );
  }
  if (updates.body && bodyEl?.objectId) {
    requests.push(
      { deleteText: { objectId: bodyEl.objectId, textRange: { type: 'ALL' } } },
      { insertText: { objectId: bodyEl.objectId, text: updates.body, insertionIndex: 0 } },
      whiteText(bodyEl.objectId, 20),
    );
  }

  if (requests.length > 0) {
    await slidesApi.presentations.batchUpdate({ presentationId, requestBody: { requests } });
  }
}

export async function deleteSlide(
  presentationId: string,
  slideIndex: number,
  oauthClient: unknown,
): Promise<void> {
  const slidesApi = google.slides({ version: 'v1', auth: oauthClient as any });
  const pres = await slidesApi.presentations.get({ presentationId });
  const slide = pres.data.slides?.[slideIndex];
  if (!slide?.objectId) throw new Error(`Slide ${slideIndex + 1} not found`);
  await slidesApi.presentations.batchUpdate({
    presentationId,
    requestBody: { requests: [{ deleteObject: { objectId: slide.objectId } }] },
  });
}
