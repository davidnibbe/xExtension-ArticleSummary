if (document.readyState && document.readyState !== 'loading') {
  configureSummarizeButtons();
} else {
  document.addEventListener('DOMContentLoaded', configureSummarizeButtons, false);
}

function configureSummarizeButtons() {
  document.getElementById('global').addEventListener('click', function (e) {
    for (var target = e.target; target && target != this; target = target.parentNode) {
      
      if (target.matches('.flux_header')) {
        target.nextElementSibling.querySelector('.oai-summary-btn').innerHTML = 'Summarize'
      }

      if (target.matches('.oai-summary-btn')) {
        e.preventDefault();
        e.stopPropagation();
        if (target.dataset.request) {
          summarizeButtonClick(target);
        }
        break;
      }
    }
  }, false);
}

function setOaiState(container, statusType, statusMsg, summaryText) {
  const button = container.querySelector('.oai-summary-btn');
  const content = container.querySelector('.oai-summary-content');
  // 根据 state 设置不同的状态
  if (statusType === 1) {
    container.classList.add('oai-loading');
    container.classList.remove('oai-error');
    content.innerHTML = statusMsg;
    button.disabled = true;
  } else if (statusType === 2) {
    container.classList.remove('oai-loading');
    container.classList.add('oai-error');
    content.innerHTML = statusMsg;
    button.disabled = false;
  } else {
    container.classList.remove('oai-loading');
    container.classList.remove('oai-error');
    if (statusMsg === 'finish'){
      button.disabled = false;
    }
  }

  console.log(content);
  
  if (summaryText) {
    content.innerHTML = summaryText.replace(/(?:\r\n|\r|\n)/g, '<br>');
  }
}

async function summarizeButtonClick(target) {
  var container = target.parentNode;
  if (container.classList.contains('oai-loading')) {
    return;
  }

  setOaiState(container, 1, '加载中', null);

  var url = target.dataset.request;
  var data = {
    ajax: true,
    _csrf: context.csrf
  };

  try {
    console.log("[summarizeButtonClick] Sending POST to:", url, "with data:", data);
    const response = await axios.post(url, data, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log("[summarizeButtonClick] Raw Axios response:", response);

    const xresp = response.data;
    console.log("[summarizeButtonClick] Parsed PHP JSON:", xresp);

    if (response.status !== 200 || !xresp.response || !xresp.response.data) {
      console.warn("[summarizeButtonClick] Invalid structure", { status: response.status, xresp });
      throw new Error('请求失败 / Request Failed');
    }

    if (xresp.response.error) {
      setOaiState(container, 2, xresp.response.data, null);
    } else {
      const oaiParams = xresp.response.data;
      const oaiProvider = xresp.response.provider;
      console.log("[summarizeButtonClick] Provider:", oaiProvider, "Params:", oaiParams);
      if (oaiProvider === 'openai') {
        await sendOpenAIRequest(container, oaiParams);
      } else if (oaiProvider === 'ollama') {
        await sendOllamaRequest(container, oaiParams);
      } else if (oaiProvider === 'gemini') {
        await sendGeminiRequest(container, oaiParams);
      }
    }
  } catch (error) {
    console.error("[summarizeButtonClick] ERROR:", error);
    if (error.response) {
      console.error("Error response data:", error.response.data);
      console.error("Error status:", error.response.status);
      console.error("Error headers:", error.response.headers);
    }
    setOaiState(container, 2, '请求失败 / Request Failed', null);
  }
}

async function sendGeminiRequest(container, oaiParams) {
  try {
    let body = JSON.parse(JSON.stringify(oaiParams));
    delete body['oai_url'];
    delete body['oai_key'];

    console.log("[sendGeminiRequest] URL:", oaiParams.oai_url);
    console.log("[sendGeminiRequest] Body:", body);

    const response = await fetch(oaiParams.oai_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${oaiParams.oai_key}`
      },
      body: JSON.stringify(body)
    });

    console.log("[sendGeminiRequest] Raw fetch response:", response);

    if (!response.ok) {
      const text = await response.text();
      console.error("[sendGeminiRequest] Non-OK HTTP status:", response.status, text);
      throw new Error('请求失败 / Request Failed');
    }

    const data = await response.json();
    console.log("[sendGeminiRequest] Parsed JSON:", data);

    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';
    setOaiState(container, 0, 'finish', marked.parse(text));
  } catch (error) {
    console.error("[sendGeminiRequest] ERROR:", error);
    setOaiState(container, 2, '请求失败 / Request Failed', null);
  }
}

async function sendOpenAIRequest(container, oaiParams) {
  try {
    let body = JSON.parse(JSON.stringify(oaiParams));
    delete body['oai_url'];
    delete body['oai_key'];

    console.log("[sendOpenAIRequest] URL:", oaiParams.oai_url);
    console.log("[sendOpenAIRequest] Body:", body);

    const response = await fetch(oaiParams.oai_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${oaiParams.oai_key}`
      },
      body: JSON.stringify(body)
    });

    console.log("[sendOpenAIRequest] Raw fetch response:", response);

    if (!response.ok) {
      const text = await response.text();
      console.error("[sendOpenAIRequest] Non-OK HTTP status:", response.status, text);
      throw new Error('请求失败 / Request Failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        setOaiState(container, 0, 'finish', null);
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      console.log("[sendOpenAIRequest] Received chunk:", chunk);
      const text = JSON.parse(chunk)?.choices[0]?.message?.content || '';
      setOaiState(container, 0, null, marked.parse(text));
    }
  } catch (error) {
    console.error("[sendOpenAIRequest] ERROR:", error);
    setOaiState(container, 2, '请求失败 / Request Failed', null);
  }
}

async function sendOllamaRequest(container, oaiParams) {
  try {
    console.log("[sendOllamaRequest] URL:", oaiParams.oai_url);
    console.log("[sendOllamaRequest] Body:", oaiParams);

    const response = await fetch(oaiParams.oai_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${oaiParams.oai_key}`
      },
      body: JSON.stringify(oaiParams)
    });

    console.log("[sendOllamaRequest] Raw fetch response:", response);

    if (!response.ok) {
      const text = await response.text();
      console.error("[sendOllamaRequest] Non-OK HTTP status:", response.status, text);
      throw new Error('请求失败 / Request Failed');
    }
  
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let text = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        setOaiState(container, 0, 'finish', null);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      console.log("[sendOllamaRequest] Current buffer:", buffer);

      let endIndex;
      while ((endIndex = buffer.indexOf('\\n')) !== -1) {
        const jsonString = buffer.slice(0, endIndex).trim();
        try {
          if (jsonString) {
            const json = JSON.parse(jsonString);
            text += json.response;
            setOaiState(container, 0, null, marked.parse(text));
          }
        } catch (e) {
          console.error("[sendOllamaRequest] JSON parse error:", e, "Chunk:", jsonString);
        }
        buffer = buffer.slice(endIndex + 1);
      }
    }
  } catch (error) {
    console.error("[sendOllamaRequest] ERROR:", error);
    setOaiState(container, 2, '请求失败 / Request Failed', null);
  }
}
