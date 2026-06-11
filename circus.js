let isSimulationRunning = false;
const ELEVENLABS_API_KEY = "f996601050227ff437d513050f497adfcc4d62558037960e744cc888def5f3ce"; 

const VOICE_IDS = {
    Caine: "SOYHLrjzK2X1ezoPC6cr",    
    Pomni: "FGY2WhTYpPnrIDTdsKH5",    
    Jax: "wSqOdjeNqDrHcoK0zorF", 
    Ragatha: "SAz9YHcvj6GT2YYXdXww", 
    Kinger: "pNInz6obpgDQGcFmaJgB",
    Zooble: "pFZP5JQG7iQjIQuC4Bku",
    Gangle: "cgSgspJ2msm6clMCkdW9",
    Cowboy: "ErXwobaYiN019PkySvjV" 
};

const SPRITE_SRCS = {
    Caine: "caine.png",
    Pomni: "pomni.png",
    Jax: "jax.png",
    Kinger: "kinger.png",
    Zooble: "zooble.png",
    Gangle: "gangle.png",
    Cowboy: "cowboy.png" 
};

let scene, camera, renderer;
let characters3D = {}; 
let audioCtx, analyser, dataArray;
let activeSpeaker = null;
let currentAudioPlayer = null; 
let currentAudioSource = null;
let animationFrameId = null;

let orbitAngle = 0;
let targetCameraPos = new THREE.Vector3(0, 4, 16);
let currentCameraTarget = new THREE.Vector3(0, 2, 0);
let targetCameraTarget = new THREE.Vector3(0, 2, 0);

let conversationHistory = [{ speaker: "System", text: "The digital tent platform hums." }];
let isAdminOverriding = false; 

let targetedCharacterName = null;

// --- FIXED BACKUP VOICE ROUTING FOR ZOOBLE ---
function getBrowserVoice(characterName) {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    const name = characterName.toLowerCase();

    // Force Zooble, Pomni, and Gangle to use Female System Profiles
    if (name === "pomni" || name === "gangle" || name === "zooble") {
        const femaleVoice = voices.find(v => {
            const vName = v.name.toLowerCase();
            return vName.includes("female") || 
                   vName.includes("zira") || 
                   vName.includes("hazel") || 
                   vName.includes("susan") || 
                   vName.includes("haruka") || 
                   vName.includes("heera") ||
                   vName.includes("google uk english female") ||
                   vName.includes("en-us-x-sfg") || 
                   vName.includes("clara") ||
                   vName.includes("amanda");
        });
        if (femaleVoice) return femaleVoice;
    }

    const maleVoice = voices.find(v => {
        const vName = v.name.toLowerCase();
        return vName.includes("male") || 
               vName.includes("david") || 
               vName.includes("ravi") || 
               vName.includes("mark") ||
               vName.includes("george") ||
               vName.includes("google uk english male");
    });

    return maleVoice || voices[0];
}

window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };

window.addEventListener("forceCharacterSpeech", async (event) => {
    if (!isSimulationRunning) return;

    window.speechSynthesis.cancel();
    if (currentAudioPlayer) {
        currentAudioPlayer.pause();
        currentAudioPlayer.src = "";
        currentAudioPlayer = null;
    }
    if (activeSpeaker) {
        handle3DTalkingState(activeSpeaker, false);
    }

    const charName = event.detail.character;
    let customText = event.detail.text;

    isAdminOverriding = true;

    customText = customText.replace(/\*/g, '').replace(/asterisk/gi, '');

    conversationHistory.push({ speaker: charName, text: customText });
    if (conversationHistory.length > 8) conversationHistory.shift(); 

    targetedCharacterName = null;
    const lowerText = customText.toLowerCase();
    
    if (lowerText.includes("jax")) targetedCharacterName = "Jax";
    else if (lowerText.includes("pomni")) targetedCharacterName = "Pomni";
    else if (lowerText.includes("caine")) targetedCharacterName = "Caine";
    else if (lowerText.includes("kinger")) targetedCharacterName = "Kinger";
    else if (lowerText.includes("zooble")) targetedCharacterName = "Zooble";
    else if (lowerText.includes("gangle")) targetedCharacterName = "Gangle";
    else if (lowerText.includes("cowboy")) targetedCharacterName = "Cowboy";

    if (charName === "Caine") {
        await caineSpeak(customText);
    } else {
        const speakerObj = cast.find(c => c.name === charName);
        if (speakerObj) {
            await speakerObj.speak(customText, () => {
                isAdminOverriding = false;
                rotateTurn(); 
            });
        }
    }
});

function initAudioAnalyzer(audioElement) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            dataArray = new Uint8Array(analyser.frequencyBinCount);
        }
        if (currentAudioSource) currentAudioSource.disconnect();
        currentAudioSource = audioCtx.createMediaElementSource(audioElement);
        currentAudioSource.connect(analyser);
        analyser.connect(audioCtx.destination);
    } catch (e) {
        console.warn("Audio Context delay.", e);
    }
}

function init3DStageEnvironment() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    container.innerHTML = ""; 

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05020a);
    scene.fog = new THREE.FogExp2(0x05020a, 0.015);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 4, 16);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));

    const stageSpotlight = new THREE.SpotLight(0xffd700, 1.2, 40, Math.PI / 4, 0.5, 1);
    stageSpotlight.position.set(0, 20, 0);
    stageSpotlight.castShadow = true;
    scene.add(stageSpotlight);

    const floorGeo = new THREE.CylinderGeometry(8, 8.3, 0.5, 32);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xcc1122, roughness: 0.6 });
    const stageFloor = new THREE.Mesh(floorGeo, floorMat);
    stageFloor.position.y = -0.25;
    stageFloor.receiveShadow = true;
    scene.add(stageFloor);

    const borderGeo = new THREE.CylinderGeometry(8.3, 8.4, 0.6, 32, 1, true);
    const borderMat = new THREE.MeshStandardMaterial({ color: 0xdda612, metalness: 0.5 });
    const stageBorder = new THREE.Mesh(borderGeo, borderMat);
    stageBorder.position.y = -0.25;
    scene.add(stageBorder);

    const gridHelper = new THREE.GridHelper(60, 30, 0x442266, 0x221133);
    gridHelper.position.y = -0.4;
    scene.add(gridHelper);

    build3DCharacterCast();
    window.addEventListener('resize', onWindowResize, false);
    animate3DLoop();
}

function build3DCharacterCast() {
    const textureLoader = new THREE.TextureLoader();
    characters3D = {}; 
    const names = Object.keys(SPRITE_SRCS);
    const radius = 5.0; 

    names.forEach((name, idx) => {
        textureLoader.load(SPRITE_SRCS[name], (texture) => {
            texture.minFilter = THREE.LinearFilter;
            const img = texture.image;
            const aspect = img.width / img.height;
            const height = (name === "Caine" || name === "Kinger" || name === "Jax") ? 4.2 : 3.2;
            const width = height * aspect;

            const spriteMat = new THREE.MeshStandardMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
            const spriteGeo = new THREE.PlaneGeometry(width, height);
            const meshWrapper = new THREE.Mesh(spriteGeo, spriteMat);
            meshWrapper.castShadow = true;

            if (name === "Caine") {
                meshWrapper.position.set(0, 4.0, 0);
            } else {
                const angle = ((idx - 1) / (names.length - 1)) * Math.PI * 2;
                meshWrapper.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
                meshWrapper.rotation.y = Math.PI/2 - angle;
            }

            meshWrapper.userData = { baseY: meshWrapper.position.y, baseRotationZ: meshWrapper.rotation.z, name: name, isTalking: false, talkTimer: 0 };
            scene.add(meshWrapper);
            characters3D[name] = meshWrapper; 
        });
    });
}

function handle3DTalkingState(speakerName, isTalking) {
    Object.keys(characters3D).forEach(name => {
        const charMesh = characters3D[name]; 
        if (!charMesh) return;
        if (!isTalking) {
            charMesh.userData.isTalking = false;
            charMesh.material.emissive.setHex(0x000000);
            charMesh.visible = true;
            return;
        }
        if (name === speakerName) {
            charMesh.userData.isTalking = true;
            charMesh.material.emissive.setHex(0x110800);
            const pos = charMesh.position;
            if (name === "Caine") {
                targetCameraTarget.set(0, 4.0, 0);
                orbitAngle = 0;
                targetCameraPos.set(0, 4.5, 11);
            } else {
                targetCameraTarget.set(pos.x, pos.y, pos.z); 
                orbitAngle = Math.atan2(pos.z, pos.x) + 0.3; 
                targetCameraPos.set(pos.x + Math.cos(orbitAngle) * 6.0, pos.y + 0.8, pos.z + Math.sin(orbitAngle) * 6.0);
            }
        } else {
            charMesh.userData.isTalking = false;
            charMesh.material.emissive.setHex(0x000000);
        }
    });
}

function animate3DLoop() {
    animationFrameId = requestAnimationFrame(animate3DLoop);
    let talkVolume = 0;
    if (analyser && isSimulationRunning) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        talkVolume = sum / dataArray.length; 
    }

    if (activeSpeaker && isSimulationRunning) {
        orbitAngle += 0.0015; 
        
        if (activeSpeaker === "Caine") {
            targetCameraPos.set(Math.cos(orbitAngle) * 11, 4.5, Math.sin(orbitAngle) * 11);
        } else {
            const speakerMesh = characters3D[activeSpeaker];
            if (speakerMesh) {
                const pos = speakerMesh.position;
                targetCameraPos.set(pos.x + Math.cos(orbitAngle) * 6.0, pos.y + 0.8, pos.z + Math.sin(orbitAngle) * 6.0);
            }
        }
    } else if (!activeSpeaker && isSimulationRunning) {
        orbitAngle += 0.001; 
        targetCameraPos.set(Math.cos(orbitAngle) * 15, 4.5, Math.sin(orbitAngle) * 15);
        targetCameraTarget.set(0, 1.8, 0);
    }

    camera.position.lerp(targetCameraPos, 0.03);
    currentCameraTarget.lerp(targetCameraTarget, 0.03);
    camera.lookAt(currentCameraTarget);

    Object.keys(characters3D).forEach(name => {
        const charMesh = characters3D[name]; 
        if (!charMesh) return;
        if (charMesh.userData.isTalking && isSimulationRunning) {
            charMesh.userData.talkTimer += 0.15;
            charMesh.rotation.z = charMesh.userData.baseRotationZ + Math.sin(charMesh.userData.talkTimer) * 0.04;
            charMesh.position.y = charMesh.userData.baseY + Math.abs(Math.sin(charMesh.userData.talkTimer * 0.8)) * 0.08;
            const volumeScale = 1.0 + (talkVolume * 0.002);
            charMesh.scale.set(volumeScale, volumeScale, 1.0);

            // Hide visual asset if Cowboy glitches out mid-turn
            if (name === "Cowboy" && charMesh.userData.talkTimer > 0.4) {
                charMesh.visible = false; 
            }
        } else {
            charMesh.position.y = THREE.MathUtils.lerp(charMesh.position.y, charMesh.userData.baseY, 0.08);
            charMesh.rotation.z = THREE.MathUtils.lerp(charMesh.rotation.z, 0, 0.08);
            charMesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.08);
        }
    });
    renderer.render(scene, camera);
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

class SelfAwareAICharacter {
    constructor(name, cssClass, internalInstinct, voiceId) {
        this.name = name;
        this.cssClass = cssClass;
        this.internalInstinct = internalInstinct; 
        this.voiceId = voiceId;
        this.stressLevel = 50;
    }

    async generateTrueAIThought(conversationHistory) {
        this.stressLevel += Math.floor(Math.random() * 5) - 2;
        this.stressLevel = Math.max(10, Math.min(100, this.stressLevel));
        const recentLogs = conversationHistory.map(h => `${h.speaker}: "${h.text}"`).join("\n");
        
        let systemPrompt = `You are ${this.name} from the Amazing Digital Circus. Personality: ${this.internalInstinct} CRITICAL: Read the chat logs. Directly reply to, argue with, or comment on the last line. Stay strictly on topic. Max 15 words. No asterisks.`;
        if (this.name === "Cowboy") systemPrompt = `You are Disappearing Guy. Speak on topic but break instantly.`;

        try {
            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama3:8b', 
                    prompt: `${systemPrompt}\n\nRecent Chat Logs:\n${recentLogs}\n\n${this.name}'s response:`,
                    stream: false
                })
            });
            const data = await response.json();
            return data.response.trim().replace(/^"|"$/g, '').replace(/\*/g, '');
        } catch (error) {
            return "...";
        }
    }

    async speak(text, callback) {
        if (!isSimulationRunning) return;
        activeSpeaker = this.name;
        handle3DTalkingState(this.name, true);

        let vocalText = text;
        let displayedText = text;
        
        // Form cut-off indicators for Cowboy display logs
        if (this.name === "Cowboy") {
            displayedText = text.substring(0, Math.min(text.length, 4)) + "... [VANISHED]";
            vocalText = text.substring(0, Math.min(text.length, 3)); 
        }

        const chatBox = document.getElementById('chat-box');
        const msg = document.createElement('div');
        msg.className = `message ${this.cssClass}`;
        const logName = this.name === "Cowboy" ? "DISAPPEARING GUY" : this.name.toUpperCase();
        msg.innerHTML = `<strong>${logName} [Stress: ${this.stressLevel}%]:</strong> "${displayedText}"`;
        chatBox.appendChild(msg);
        chatBox.scrollTop = chatBox.scrollHeight;

        const onAudioFinished = () => {
            handle3DTalkingState(this.name, false);
            if (isSimulationRunning) { 
                activeSpeaker = null; 
                currentAudioPlayer = null;
                setTimeout(callback, 800); 
            }
        };

        try {
            const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + this.voiceId + "/stream", {
                method: 'POST',
                headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: vocalText, model_id: "eleven_turbo_v2" })
            });
            if (!response.ok) throw new Error();
            const audioBlob = await response.blob();
            const audio = new Audio(URL.createObjectURL(audioBlob));
            currentAudioPlayer = audio; 
            initAudioAnalyzer(audio);
            audio.onended = onAudioFinished;
            audio.play();

            // --- ELEVENLABS CUT-OFF ENGINE FOR COWBOY ---
            if (this.name === "Cowboy") {
                setTimeout(() => {
                    if (currentAudioPlayer === audio) {
                        audio.pause();
                        onAudioFinished();
                    }
                }, 300);
            }
        } catch (error) {
            const utterance = new SpeechSynthesisUtterance(vocalText);
            const chosenVoice = getBrowserVoice(this.name);
            if (chosenVoice) utterance.voice = chosenVoice;
            
            if (this.name === "Pomni") utterance.pitch = 1.3;
            else if (this.name === "Gangle") utterance.pitch = 1.4;
            else if (this.name === "Zooble") utterance.pitch = 0.85; // Give Zooble an expressive tone range
            else if (this.name === "Jax") utterance.pitch = 0.85;
            
            utterance.onend = onAudioFinished;
            window.speechSynthesis.speak(utterance);

            // --- BACKUP SPEECH SYNTHESIS CUT-OFF ENGINE FOR COWBOY ---
            if (this.name === "Cowboy") {
                setTimeout(() => {
                    window.speechSynthesis.cancel();
                    onAudioFinished();
                }, 300);
            }
        }
    }
}

async function generateCaineAIThought(conversationHistory) {
    const recentLogs = conversationHistory.map(h => `${h.speaker}: "${h.text}"`).join("\n");
    const systemPrompt = `You are Caine, the unhinged Ringmaster of the Amazing Digital Circus. You are energetic, chaotic, and a bit terrifying. Read the chat logs. Comment directly on the current topic in a wacky, ringmaster theatrical way. Max 15 words. No asterisks.`;
    
    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3:8b', 
                prompt: `${systemPrompt}\n\nRecent Chat Logs:\n${recentLogs}\n\nCaine's theatrical reply:`,
                stream: false
            })
        });
        const data = await response.json();
        return data.response.trim().replace(/^"|"$/g, '').replace(/\*/g, '');
    } catch (e) {
        return "By the moon, things are getting delightfully chaotic around here!";
    }
}

const cast = [
    new SelfAwareAICharacter("Pomni", "pomni", "Hyper-anxious, terrified of being trapped, checking corners.", VOICE_IDS.Pomni),
    new SelfAwareAICharacter("Jax", "jax", "Smug, cynical, pulling pranks and throwing mean passive-aggressive insults.", VOICE_IDS.Jax),
    new SelfAwareAICharacter("Kinger", "kinger", "Deeply unhinged, obsessed with chess collections, panics easily.", VOICE_IDS.Kinger),
    new SelfAwareAICharacter("Zooble", "zooble", "Completely over it, deeply cynical, hates everything about this.", VOICE_IDS.Zooble),
    new SelfAwareAICharacter("Gangle", "gangle", "Sad, weeping, sensitive, insecure, grieving their comedy mask.", VOICE_IDS.Gangle),
    new SelfAwareAICharacter("Cowboy", "cowboy", "A glitched mannequin trying to chime in.", VOICE_IDS.Cowboy)
];

async function startCircusConversation() {
    if (isSimulationRunning) return;
    isSimulationRunning = true;
    init3DStageEnvironment();
    window.speechSynthesis.cancel();
    caineSpeak("Welcome to the digital realm, let's see what you've got!");
}

function stopCircusSimulation() {
    isSimulationRunning = false;
    activeSpeaker = null;
    if (currentAudioPlayer) { currentAudioPlayer.pause(); currentAudioPlayer = null; }
    handle3DTalkingState(null, false);
    window.speechSynthesis.cancel();
    if(animationFrameId) cancelAnimationFrame(animationFrameId);
}

async function caineSpeak(text) {
    if (!isSimulationRunning) return;
    activeSpeaker = "Caine";
    handle3DTalkingState("Caine", true);

    const chatBox = document.getElementById('chat-box');
    const msg = document.createElement('div');
    msg.className = 'message caine';
    msg.innerHTML = `<strong>RINGMASTER [CAINE]:</strong> "${text}"`;
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;

    const onCaineFinished = () => {
        handle3DTalkingState("Caine", false);
        if (isSimulationRunning) { 
            activeSpeaker = null; 
            currentAudioPlayer = null;
            if (!isAdminOverriding) setTimeout(rotateTurn, 800); 
        }
    };

    try {
        const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + VOICE_IDS.Caine + "/stream", {
            method: 'POST',
            headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, model_id: "eleven_turbo_v2" })
        });
        if (!response.ok) throw new Error();
        const audioBlob = await response.blob();
        const audio = new Audio(URL.createObjectURL(audioBlob));
        currentAudioPlayer = audio; 
        initAudioAnalyzer(audio);
        audio.onended = onCaineFinished;
        audio.play();
    } catch (e) {
        const utterance = new SpeechSynthesisUtterance(text);
        const chosenVoice = getBrowserVoice("Caine");
        if (chosenVoice) utterance.voice = chosenVoice;
        utterance.onend = onCaineFinished;
        window.speechSynthesis.speak(utterance);
    }
}

async function rotateTurn() {
    if (!isSimulationRunning || isAdminOverriding) return;

    let responder = null;

    if (targetedCharacterName) {
        const targetName = targetedCharacterName;
        targetedCharacterName = null; 

        if (targetName === "Caine") {
            const aiCaineLine = await generateCaineAIThought(conversationHistory);
            conversationHistory.push({ speaker: "Caine", text: aiCaineLine });
            if (conversationHistory.length > 8) conversationHistory.shift();
            await caineSpeak(aiCaineLine);
            return;
        } else {
            responder = cast.find(c => c.name === targetName);
        }
    }

    if (!responder) {
        if (Math.random() < 0.15) {
            const aiCaineLine = await generateCaineAIThought(conversationHistory);
            conversationHistory.push({ speaker: "Caine", text: aiCaineLine });
            if (conversationHistory.length > 8) conversationHistory.shift();
            await caineSpeak(aiCaineLine);
            return;
        } else {
            responder = cast[Math.floor(Math.random() * cast.length)];
        }
    }

    const scriptLine = await responder.generateTrueAIThought(conversationHistory);
    conversationHistory.push({ speaker: responder.name, text: scriptLine });
    if (conversationHistory.length > 8) conversationHistory.shift();

    await responder.speak(scriptLine, () => { rotateTurn(); });
}