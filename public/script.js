const sendbutton = document.getElementById('sendbutton');
const responsesList = document.getElementById('responsesList');

let responses = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function displayResponses() {
    if (responses.length === 0) {
        responsesList.innerHTML = '<p class="text-gray-500 text-center">No requests yet</p>';
        return;
    }

    responsesList.innerHTML = responses.map((item) => {
        return `
            <div class="border p-3 rounded text-sm">
                <p class="text-black text-xs mt-1">${item.message}</p>
            </div>
        `;
    }).join('');
}

function updateResponse(requestId, updates) {
    const index = responses.findIndex((item) => item.requestId === requestId);
    if (index === -1) {
        return;
    }

    responses[index] = {
        ...responses[index],
        ...updates,
    };
    displayResponses();
}

async function pollStatus(requestId) {
    const maxWaitMs = 70_000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
        try {
            const statusResponse = await fetch(`/status/${requestId}`);
            if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                updateResponse(requestId, {
                    message: statusData.message,
                    status: statusData.status,
                });

                if (statusData.status !== 'queued') {
                    return;
                }
            }
        } catch (error) {
            console.error('Status polling error:', error);
        }

        await sleep(1000);
    }

    updateResponse(requestId, {
        status: 'timeout',
        message: 'Request status polling timed out on the client.',
    });
}

async function sendRequest() {
    const algorithm = document.querySelector('input[name="algorithm"]:checked').value;
    sendbutton.disabled = true;

    try {
        const response = await fetch('/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ algorithm: algorithm })
        });

        const data = await response.json();
        const responseItem = {
            requestId: data.requestId || `local-${Date.now()}`,
            message: data.message,
            status: response.status === 202 ? 'queued' : 'sent',
        };

        responses.unshift(responseItem);
        displayResponses();

        if (response.status === 202 && data.requestId) {
            pollStatus(data.requestId);
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        sendbutton.disabled = false;
    }
}

sendbutton.addEventListener('click', sendRequest);
