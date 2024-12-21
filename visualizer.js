// Three.js and Cannon.js setup
let scene, camera, renderer, world;
let spheres = [], sphereBodies = [];
let sphereData = [];
let lastProcessedBlockNumber = 0;
let sonic_sent = 0;
let ground;
let room;
let hoveredSphere = null;
const RPC_URL = "https://rpc.soniclabs.com";
const BLOCK_EXPLORER = "https://sonicscan.org/tx"
const MIN_AMOUNT = 0.1
const MAX_AMOUNT = 100000

// Set up tooltip
const tooltipDiv = document.createElement('div');
tooltipDiv.style.cssText = `
    position: fixed;
    background: rgba(0, 0, 0, 0.5);
    color: white;
    padding: 8px;
    border-radius: 8px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    pointer-events: none;
    display: none;
    z-index: 999;
`;
document.body.appendChild(tooltipDiv);

// Add mousemove event listener
function setupMouseHandlers() {
    const canvas = renderer.domElement;
    canvas.addEventListener('click', onSphereClick);
    canvas.addEventListener('mousemove', onMouseMove);
    
    // Reset cursor when mouse leaves canvas
    canvas.addEventListener('mouseleave', () => {
        canvas.style.cursor = 'default';
        tooltipDiv.style.display = 'none';
    });
}

// Replace your existing onSphereClick with this updated version
function onSphereClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(spheres, false);

    if (intersects.length > 0) {
        const clickedSphere = intersects[0].object;
        const sphereIndex = spheres.indexOf(clickedSphere);
        if (sphereIndex !== -1 && sphereData[sphereIndex]) {
            window.open(`${BLOCK_EXPLORER}/${sphereData[sphereIndex].hash}`, '_blank');
        }
    }
}

// Add new mousemove handler
function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(spheres, false);

    const canvas = renderer.domElement;
    
    if (intersects.length > 0) {
        const intersectedSphere = intersects[0].object;
        const sphereIndex = spheres.indexOf(intersectedSphere);
        
        if (sphereIndex !== -1 && sphereData[sphereIndex]) {
            canvas.style.cursor = 'pointer';
            hoveredSphere = intersectedSphere;
            
            // Update tooltip content and position
            const amount = sphereData[sphereIndex].amount;
            tooltipDiv.textContent = `${amount.toFixed(6).replace(/\.?0+$/, '')} S`;
            tooltipDiv.style.display = 'block';
            tooltipDiv.style.left = `${event.clientX + 15}px`;
            tooltipDiv.style.top = `${event.clientY + 15}px`;
        }
    } else {
        canvas.style.cursor = 'default';
        hoveredSphere = null;
        tooltipDiv.style.display = 'none';
    }
}

// Add raycaster for click detection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function createRoomEnvironment() {
    const roomGeometry = new THREE.BoxGeometry(250, 250, 250);
    roomGeometry.scale(-1, 1, -1);

    // Create gradient texture with dots
    const canvas = document.createElement('canvas');
    canvas.width = 2048; // Increased for environment map
    canvas.height = 1024; // Height should be half for equirectangular
    const ctx = canvas.getContext('2d');

    // Define colors
    const darkBlue = '#0a1824';
    const brownish = '#492927';
    const peach = '#9b6b4a';

    // Create a more environment-map friendly gradient
    const gradientHeight = canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, 0, gradientHeight);
    gradient.addColorStop(1, darkBlue);    // Top
    gradient.addColorStop(0.5, brownish);  // Middle
    gradient.addColorStop(0, peach);       // Bottom
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add dots
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    const dotSize = 1.5;
    const spacing = 20;
    
    for (let x = 0; x < canvas.width; x += spacing) {
        for (let y = 0; y < canvas.height; y += spacing) {
            ctx.beginPath();
            ctx.arc(x, y, dotSize, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Create wall texture
    const wallTexture = new THREE.CanvasTexture(canvas);
    wallTexture.wrapS = THREE.RepeatWrapping;
    wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(1, 1);

    // Create the visible room
    const roomMaterial = new THREE.MeshStandardMaterial({
        map: wallTexture,
        side: THREE.BackSide,
        metalness: 0.2,
        roughness: 0.8
    });

    const room = new THREE.Mesh(roomGeometry, roomMaterial);
    room.position.set(0, -50, -100);
    scene.add(room);

    // Create environment map texture
    const envTexture = new THREE.CanvasTexture(canvas);
    envTexture.mapping = THREE.EquirectangularReflectionMapping;

    // Generate env map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envMap = pmremGenerator.fromEquirectangular(envTexture);
    scene.environment = envMap.texture;
    
    pmremGenerator.dispose();
    envTexture.dispose();

    return room;
}

function createLogoTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Create base color
    ctx.fillStyle = '#0048b2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Load and draw SVG
    const img = new Image();
    const blob = new Blob([document.querySelector('#platform-logo').outerHTML], {type: 'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    
    return new Promise((resolve) => {
        img.onload = () => {
            // Draw the logo at 80% size, centered
            const size = canvas.width * 0.9;
            const x = (canvas.width - size) / 2;
            const y = (canvas.height - size) / 2;
            ctx.drawImage(img, x, y, size, size);
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            URL.revokeObjectURL(url);
            resolve(texture);
        };
        img.src = url;
    });
}

function onSphereClick(event) {
    // Calculate mouse position in normalized device coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, camera);

    // Calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObjects(spheres, false);  // Add false parameter here

    if (intersects.length > 0) {
        const clickedSphere = intersects[0].object;
        const sphereIndex = spheres.indexOf(clickedSphere);
        if (sphereIndex !== -1 && sphereData[sphereIndex]) {
            console.log('Opening transaction:', sphereData[sphereIndex].hash); // Add this for debugging
            window.open(`${BLOCK_EXPLORER}/${sphereData[sphereIndex].hash}`, '_blank');
        }
    }
}

// Initialize the scene
async function init() {
    // Create Three.js scene
    scene = new THREE.Scene();
    scene.background = null;

    // Setup camera
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 20, 70);
    camera.lookAt(0, 0, 0);

    // Setup renderer - MUST come before creating room
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.cursor = 'pointer';
    document.body.appendChild(renderer.domElement);

    // Create room - NOW after renderer is initialized
    room = createRoomEnvironment();

    // Rest of the init function remains the same...
    const ambientLight = new THREE.AmbientLight(0x666666, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffead2, 0.8);
    directionalLight.position.set(10, 20, 20);
    directionalLight.castShadow = false;
    scene.add(directionalLight);

    // Initialize physics world
    world = new CANNON.World();
    world.gravity.set(0, -7.82, 0);

    // Create ground
    await createGround();

    // Detect on click
    setupMouseHandlers();

    // Start animation loop
    animate();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);
}

// Create ground plane
async function createGround() {
    // Physics ground
    const groundShape = new CANNON.Box(new CANNON.Vec3(25, 10, 25));
    const groundBody = new CANNON.Body({
        mass: 0,
        shape: groundShape,
        material: new CANNON.Material()
    });
    groundBody.position.set(0, -15, 0);
    world.add(groundBody);

    // Create two materials: one for top (with logo) and one for sides
    const logoTexture = await createLogoTexture();
    
    const topMaterial = new THREE.MeshStandardMaterial({
        color: 0x0048b2,
        metalness: 0.95,
        roughness: 0.05,
        envMapIntensity: 2,
        map: logoTexture
    });

    const sideMaterial = new THREE.MeshStandardMaterial({
        color: 0x0048b2,
        metalness: 0.95,
        roughness: 0.05,
        envMapIntensity: 2
    });

    // Create an array of materials for each face
    // Order: right, left, top, bottom, front, back
    const materials = [
        sideMaterial,    // right
        sideMaterial,    // left
        topMaterial,     // top
        sideMaterial,    // bottom
        sideMaterial,    // front
        sideMaterial     // back
    ];

    // Create geometry and mesh with multiple materials
    const geometry = new THREE.BoxGeometry(50, 20, 50);
    ground = new THREE.Mesh(geometry, materials);
    ground.position.copy(groundBody.position);
    ground.receiveShadow = true;
    scene.add(ground);
}

// Create a sphere based on transaction amount
function createSphere(amount, txHash) {
    // Scale the size based on amount (MIN_AMOUNT = smallest, 1000000 = largest)
    // Using log scale for better distribution across wide range
    const logMin = Math.log10(MIN_AMOUNT);
    const logMax = Math.log10(MAX_AMOUNT);
    const logAmount = Math.log10(Math.max(MIN_AMOUNT, Math.min(MAX_AMOUNT, amount)));
    const normalizedSize = (logAmount - logMin) / (logMax - logMin); // 0 to 1
    const size = 0.3 + (normalizedSize * 12); // Map to 0.3 to 12.2 units
    
    // Physics sphere with mass proportional to size
    const sphereShape = new CANNON.Sphere(size);
    const sphereBody = new CANNON.Body({
        mass: Math.pow(size, 3), // Mass increases with volume
        shape: sphereShape,
        material: new CANNON.Material()
    });
    
    // Random position above the scene with more height variation
    sphereBody.position.set(
        (Math.random() - 0.5) * 20,  // x: -10 to 10
        50 + (Math.random() * 60),   // y: 50 to 110
        (Math.random() - 0.5) * 20   // z: -10 to 10
    );
    
    world.add(sphereBody);
    sphereBodies.push(sphereBody);

    // Determine sphere color based on amount
    let sphereColor;
    // Calculate segments based on amount
    const minSegments = 10;
    const maxSegments = 48;

    // Get normalized value between 0 and 1 based on amount
    let normalizedAmount;
    if (amount === 0) {
        normalizedAmount = 0;
    } else {
        normalizedAmount = (logAmount - logMin) / (logMax - logMin);
    }

    // Calculate segments - scale between min and max segments
    const segmentSize = Math.round(minSegments + (normalizedAmount * (maxSegments - minSegments)));
    if (amount > 1) {
        console.info(`${amount} S at ${txHash}`);
    }

    // Set colors based on amount thresholds
    if (amount === 0) {
        sphereColor = 0x2a0029; // black
    } else if (amount < 1) {
        sphereColor = 0xcc2222; // red
    } else if (amount <= 1000) {
        sphereColor = 0xca6749; // orange
    } else if (amount <= 100000) {
        sphereColor = 0x1c368b; // blue
    } else {
        sphereColor = 0x378c2b; // green
    }

    const geometry = new THREE.SphereGeometry(size, segmentSize, segmentSize);

    const material = new THREE.MeshStandardMaterial({
        color: sphereColor,
        metalness: 0.9,
        roughness: 0.2,
        envMapIntensity: 1.5,
    });
    
    const sphere = new THREE.Mesh(geometry, material);
    sphere.castShadow = false;
    sphere.receiveShadow = false;
    scene.add(sphere);
    spheres.push(sphere);
    sphereData.push({ hash: txHash, amount: amount });

    // Clean up old spheres if too many
    if (spheres.length > 1000) {
        const oldSphere = spheres.shift();
        const oldBody = sphereBodies.shift();
        sphereData.shift(); // Remove corresponding transaction data
        oldSphere.geometry.dispose();
        oldSphere.material.dispose();
        scene.remove(oldSphere);
        world.remove(oldBody);
    }
}

// RPC Functions
async function getLatestBlockAndTransactions() {
    try {
        // Get latest block number
        const latestBlockResponse = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_blockNumber',
                params: []
            })
        });
        const latestBlockData = await latestBlockResponse.json();
        const latestBlockNumber = parseInt(latestBlockData.result, 16);

        if (latestBlockNumber <= lastProcessedBlockNumber) {
            return null;
        }

        // Get block details
        const blockResponse = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'eth_getBlockByNumber',
                params: [
                    `0x${latestBlockNumber.toString(16)}`,
                    true
                ]
            })
        });
        const blockData = await blockResponse.json();
        const transactions = blockData.result?.transactions;

        lastProcessedBlockNumber = latestBlockNumber;

        return transactions?.map(tx => ({
            hash: tx.hash,
            amount: parseInt(tx.value, 16) / 1e18,
            subtype: tx.to ? 'send' : 'contract_creation'
        }));
    } catch (error) {
        console.error('Error fetching data:', error);
        return null;
    }
}

function processTransaction(txData) {
    sonic_sent += txData.amount;
    createSphere(txData.amount, txData.hash);
    
    // Update UI
    document.getElementById("current-tx").innerHTML = 
        `Total Sent: ${sonic_sent.toFixed(4)}`;
    document.getElementById("current-queue").innerHTML = 
        `Balls: ${spheres.length}`;
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Step physics world
    world.step(1 / 60);
    
    // Update sphere positions
    for (let i = 0; i < spheres.length; i++) {
        spheres[i].position.copy(sphereBodies[i].position);
        spheres[i].quaternion.copy(sphereBodies[i].quaternion);
    }
    
    // Remove spheres that have fallen below a certain point
    for (let i = spheres.length - 1; i >= 0; i--) {
        if (spheres[i].position.y < -50) {
            // Dispose of geometries and materials to prevent memory leaks
            spheres[i].geometry.dispose();
            spheres[i].material.dispose();
            scene.remove(spheres[i]);
            world.remove(sphereBodies[i]);
            spheres.splice(i, 1);
            sphereBodies.splice(i, 1);
            sphereData.splice(i, 1);
        }
    }
    
    renderer.render(scene, camera);
}

// Window resize handler
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Poll for new blocks
function pollForNewBlocks() {
    setInterval(async () => {
        const transactions = await getLatestBlockAndTransactions();
        if (transactions) {
            transactions.forEach(processTransaction);
        }
    }, 400);
}

// Initialize everything
init();
pollForNewBlocks();