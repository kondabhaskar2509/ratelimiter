const sendbutton = document.getElementById('sendbutton');
const responsesList = document.getElementById('responsesList');

let responses = [];

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
        const responseItem = {message: data.message};
        responses.unshift(responseItem);
        displayResponses();
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        sendbutton.disabled = false;
    }
}

function displayResponses() {
    if (responses.length === 0) {
        responsesList.innerHTML = '<p class="text-gray-500 text-center">No requests yet</p>';
        return;
    }

    responsesList.innerHTML = responses.map((item, index) => {
        return `
            <div class="border p-3 rounded text-sm">
                <p class="text-black text-xs mt-1">${item.message}</p>
            </div>
        `;
    }).join('');
}

sendbutton.addEventListener('click', sendRequest);
