// Three.js and Cannon.js setup
let scene, camera, renderer, world;
let spheres = [], sphereBodies = [];
let sphereData = [];
let sonic_sent = 0;
let selectedSphereGlobal = null;
let ground;
let room;
let hoveredSphere = null;
let transactionTimes = [];
let groundBody;
const processedBlockHashes = new Set();
let pendingRequest = null;

// TX settings
const RPC_URL = "https://rpc.soniclabs.com";
const BLOCK_EXPLORER = "https://sonicscan.org/tx";
const MIN_AMOUNT = 0.1; // Min Sonic
const MAX_AMOUNT = 100000; // Max Sonic
const TPS_WINDOW = 30000; // 30 seconds

// Sphere settings
const MAX_SPHERES = 1000; // Before FIFO
const MIN_SPHERE_SIZE = 0.4;
const MAX_SPHERE_SIZE = 12;
const MIN_SPHERE_SEGMENTS = 10; // Resolution
const MAX_SPHERE_SEGMENTS = 40; // Resolution
const BOUNCE_RESTITUTION = 0.5;

// Ground settings
const TILT_START = MAX_SPHERES / 2;  // Start tilting at half max
const MAX_TILT = Math.PI / 90;      // 2 degree in radians max tilt

// Environment settings
 // target fps (higher = more cpu)
const TIME_STEP = 1 / 40;
const MAX_TIME_STEP = 1 / 20;
// down force
const GRAVITY = 9;
// ambient light
const AMBIENT_INTENSITY = 0.5;
// directional light
const DIRECTIONAL_INTENSITY = 1.2;

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

// Show transaction details on click on the panel
function onSphereClick(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects([...spheres, window.statsHitPlane]);

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    
    if (hit === window.statsHitPlane && selectedSphereGlobal) {
      navigateToTransaction(selectedSphereGlobal);
    } else if (spheres.includes(hit)) {
      const sphereIndex = spheres.indexOf(hit);
      if (sphereIndex !== -1 && sphereData[sphereIndex]) {
        selectedSphere = sphereData[sphereIndex];
        if (window.updateStatsDisplay) {
          window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphere);
        }
      }
    }
  }
}

// Add new mousemove handler
function onMouseMove(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  
  const intersects = raycaster.intersectObjects([...spheres, window.statsHitPlane]);
  const canvas = renderer.domElement;
  
  if (intersects.length > 0) {
    const hit = intersects[0].object;
    
    if (hit === window.statsHitPlane && selectedSphereGlobal) {
      canvas.style.cursor = 'pointer';
      if (!window.isStatsHovered) {
        window.isStatsHovered = true;
        // Update display to show hover state
        if (window.updateStatsDisplay) {
          window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphereGlobal);
        }
      }
    } else if (spheres.includes(hit)) {
      if (window.isStatsHovered) {
        window.isStatsHovered = false;
        // Update display to remove hover state
        if (window.updateStatsDisplay) {
          window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphereGlobal);
        }
      }
      canvas.style.cursor = 'pointer';
      hoveredSphere = hit;
      
      const sphereIndex = spheres.indexOf(hit);
      if (sphereIndex !== -1 && sphereData[sphereIndex]) {
        const amount = sphereData[sphereIndex].amount;
        tooltipDiv.textContent = `${amount.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: amount > 1 ? 0 : 8})} S`;
        tooltipDiv.style.display = 'block';
        tooltipDiv.style.left = `${event.clientX + 15}px`;
        tooltipDiv.style.top = `${event.clientY + 15}px`;
      }
    }
  } else {
    if (window.isStatsHovered) {
      window.isStatsHovered = false;
      // Update display to remove hover state
      if (window.updateStatsDisplay) {
        window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphereGlobal);
      }
    }
    canvas.style.cursor = 'default';
    hoveredSphere = null;
    tooltipDiv.style.display = 'none';
  }
}

// Add raycaster for click detection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function createRoomEnvironment() {
  const roomGeometry = new THREE.BoxGeometry(250, 320, 250);
  roomGeometry.scale(-1, 1, -1);

  // Create gradient texture with dots
  const canvas = document.createElement('canvas');
  canvas.width = 2500;
  canvas.height = 2500;
  const ctx = canvas.getContext('2d');

  // Define colors
  const darkBlue = '#000';
  const brownish = '#492927';
  const peach = '#a97552';

  // Create a more environment-map friendly gradient
  const gradientHeight = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, 0, gradientHeight);
  gradient.addColorStop(1, darkBlue);    // Top
  gradient.addColorStop(0.5, brownish);  // Middle
  gradient.addColorStop(0, peach);       // Bottom
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Add dots to the walls
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  const dotSize = 2.5;
  const spacing = 40;
  
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
    metalness: 0.5,
    roughness: 0.8
  });

  const room = new THREE.Mesh(roomGeometry, roomMaterial);
  room.position.set(0, -80, -100);
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

// TPS for stats display
function calculateTPS() {
  const now = Date.now();
  // Remove transactions older than 30 seconds
  transactionTimes = transactionTimes.filter(time => now - time < TPS_WINDOW);
  // Calculate TPS based on remaining transactions
  return (transactionTimes.length / 30).toFixed(2);
}

// Navigate to transaction
function navigateToTransaction(sphere) {
  console.log("Navigating to transaction:", sphere.hash);
  window.open(`${BLOCK_EXPLORER}/${sphere.hash}`, '_blank');
}

// Stats display texture
function createStatsTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 500;
  canvas.height = 250;
  const ctx = canvas.getContext('2d');
  
  // Create hit test plane for the link
  const hitTestGeometry = new THREE.PlaneGeometry(1, 1);
  const hitTestMaterial = new THREE.MeshBasicMaterial({ 
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });
  const hitTestPlane = new THREE.Mesh(hitTestGeometry, hitTestMaterial);
  scene.add(hitTestPlane);
  window.statsHitPlane = hitTestPlane;
  window.isStatsHovered = false;
  
  function updateTexture(totalSent, ballCount, tps, selectedSphere) {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(86, 54, 57, 1)');
    gradient.addColorStop(1, 'rgba(51, 35, 50, 1)');
     
    const borderColor = 'rgb(7, 12, 33)';
    const borderWidth = 5;
     
    // Draw rounded rectangle with border
    const rx = 20;
    const ry = 20;
    const width = canvas.width - 40;
    const height = canvas.height - 40;
    const x = 27;
    const y = 12;
     
    // Draw the border
    ctx.beginPath();
    ctx.moveTo(x + rx, y);
    ctx.lineTo(x + width - rx, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + ry);
    ctx.lineTo(x + width, y + height - ry);
    ctx.quadraticCurveTo(x + width, y + height, x + width - rx, y + height);
    ctx.lineTo(x + rx, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - ry);
    ctx.lineTo(x, y + ry);
    ctx.quadraticCurveTo(x, y, x + rx, y);
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
     
    // Fill the background
    ctx.fillStyle = gradient;
    ctx.fill();
   
    // Set text properties
    ctx.font = '32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
   
    // Draw first three lines in white
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.fillText(`Volume: ${totalSent.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 4})} S`, canvas.width/2, canvas.height/5 - canvas.height/30);
    ctx.fillText(`TPS: ${tps}`, canvas.width/2, canvas.height * 2/5 - canvas.height/30);
    ctx.fillText(`Balls: ${ballCount}`, canvas.width/2, canvas.height * 3/5 - canvas.height/30);
    
    // Handle selected sphere text
    if (selectedSphere) {
      const prefix = 'TX: ';
      const amount = `${selectedSphere.amount.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: selectedSphere.amount > 1 ? 0 : 8})} S`;
      
      // Measure text widths for centering
      ctx.textAlign = 'left';
      const totalWidth = ctx.measureText(prefix + amount).width;
      const prefixWidth = ctx.measureText(prefix).width;
      
      // Calculate positions
      const y = canvas.height * 4/5 - canvas.height/30;
      const startX = (canvas.width - totalWidth) / 2;
      const amountX = startX + prefixWidth;
      
      // Draw prefix in white
      ctx.fillStyle = 'rgba(255, 255, 255, 1)';
      ctx.fillText(prefix, startX, y);
      
      // Draw amount in blue (brighter when hovering)
      ctx.fillStyle = window.isStatsHovered ? '#66d9ff' : '#4A9EFF';
      ctx.fillText(amount, amountX, y);

      // Update hit test plane position and size to match the amount text
      const worldX = ((amountX - canvas.width/2) / canvas.width) * 40 * 2.05;
      const worldY = ((canvas.height/2 - y) / canvas.height) * 20 * 2.05;
      const panelWidth = 82;
      const worldHeight = (40 / canvas.height) * 20 * 2.05; // Height for clickable area

      hitTestPlane.position.set(0, worldY + 22.5, -223.8); // Centered
      hitTestPlane.scale.set(panelWidth - 8, worldHeight, 1); // Full width with padding
    } else {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 1)';
      ctx.fillText('TX: Click a ball', canvas.width/2, canvas.height * 4/5 - canvas.height/30);
      
      // Hide hit test plane when no sphere is selected
      hitTestPlane.scale.set(0, 0, 0);
    }
    
    return new THREE.CanvasTexture(canvas);
  }
  
  const texture = updateTexture(0, 0, '0.00', null);
  texture.update = updateTexture;
  return texture;
}

// Stats display
function createStatsDisplay() {
  const statsTexture = createStatsTexture();
  
  // Create a plane geometry for the display
  const geometry = new THREE.PlaneGeometry(40, 20);
  const material = new THREE.MeshStandardMaterial({
    map: statsTexture,
    transparent: true,
    opacity: 0.9,
    metalness: 0.5,
    roughness: 0.5
  });

  const statsPlane = new THREE.Mesh(geometry, material);
  statsPlane.position.set(0, 22.5, -224); // Position on the front wall
  statsPlane.scale.set(2.05,2.05,2.05);
  scene.add(statsPlane);

  // Store reference to update the display - Added tps parameter here
  window.updateStatsDisplay = (totalSent, ballCount, tps, selectedSphere) => {
    selectedSphereGlobal = selectedSphere;
    material.map = statsTexture.update(totalSent, ballCount, tps, selectedSphere);
    material.map.needsUpdate = true;
  };
}

// Calculate ground tilt based on sphere count
function calculateTilt(sphereCount) {
  if (sphereCount <= TILT_START) {
    return 0;
  }
  
  // Calculate tilt between 0 and MAX_TILT based on sphere count
  const tiltProgress = (sphereCount - TILT_START) / (MAX_SPHERES - TILT_START);
  return Math.min(tiltProgress * MAX_TILT, MAX_TILT);
}

function createToggleButton() {
  const container = document.getElementById('toggle-container');
  
  // Create toggle wrapper
  const toggleWrapper = document.createElement('div');
  toggleWrapper.className = 'fixed top-4 left-4 flex items-center gap-2 opacity-70';
  
  // Create the switch
  const toggleSwitch = document.createElement('label');
  toggleSwitch.className = 'relative inline-block w-12 h-6';
  
  // Create the checkbox input
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'sr-only';
  
  // Create the slider
  const slider = document.createElement('span');
  slider.className = `absolute cursor-pointer inset-0 rounded-full 
    bg-gray-300 transition-colors duration-200
    before:content-[''] before:absolute before:w-4 before:h-4 
    before:left-1 before:bottom-1 before:bg-white before:rounded-full
    before:transition-transform before:duration-200`;
  
  // Create label text
  const label = document.createElement('span');
  label.className = 'text-white font-semibold text-sm';
  label.textContent = 'No 0-txs';
  
  // Add click handler
  checkbox.addEventListener('change', () => {
    window.ignoreZeroTransactions = checkbox.checked;
    
    // Update slider appearance
    if (checkbox.checked) {
      slider.className = `absolute cursor-pointer inset-0 rounded-full 
        bg-blue-600 transition-colors duration-200
        before:content-[''] before:absolute before:w-4 before:h-4 
        before:left-1 before:bottom-1 before:bg-white before:rounded-full
        before:transition-transform before:duration-200 before:translate-x-6`;
      label.className = 'text-white font-semibold';
    } else {
      slider.className = `absolute cursor-pointer inset-0 rounded-full 
        bg-gray-300 transition-colors duration-200
        before:content-[''] before:absolute before:w-4 before:h-4 
        before:left-1 before:bottom-1 before:bg-white before:rounded-full
        before:transition-transform before:duration-200`;
      label.className = 'text-white font-semibold';
    }
  });
  
  // Assemble the toggle
  toggleSwitch.appendChild(checkbox);
  toggleSwitch.appendChild(slider);
  toggleWrapper.appendChild(toggleSwitch);
  toggleWrapper.appendChild(label);
  container.appendChild(toggleWrapper);
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
  renderer.shadowMap.enabled = false;
  renderer.domElement.style.cursor = 'pointer';
  document.body.appendChild(renderer.domElement);

  // Create room - NOW after renderer is initialized
  room = createRoomEnvironment();
  createStatsDisplay();

  // Rest of the init function remains the same...
  const ambientLight = new THREE.AmbientLight(0x666666, AMBIENT_INTENSITY);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffead2, DIRECTIONAL_INTENSITY);
  directionalLight.position.set(10, 20, 20);
  directionalLight.castShadow = false;
  scene.add(directionalLight);

  // Initialize physics world
  world = new CANNON.World();
  world.gravity.set(0, -GRAVITY, 0);
  // world.allowSleep = true;

  // Create ground
  await createGround();

  // Create toggle button
  createToggleButton();

  // Detect on click
  setupMouseHandlers();

  // Start animation loop
  animate();

  // Handle window resize
  window.addEventListener('resize', onWindowResize, false);
}

// Ground logo texture
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

// Create ground plane
async function createGround() {
  // Physics ground
  const width = window.innerWidth < 1000 ? window.innerWidth / 30 : 25;
  const height = 2;
  const depth = 25;
  const groundShape = new CANNON.Box(new CANNON.Vec3(width, height, depth));
  groundBody = new CANNON.Body({ // global var for reference
    mass: 0,
    shape: groundShape,
    material: new CANNON.Material({
      restitution: BOUNCE_RESTITUTION,
    })
  });

  /**
  // Configure ground for better collision handling
  groundBody.collisionResponse = true;
  
  // Add contact material between spheres and ground
  const groundMaterial = new CANNON.Material();
  const sphereMaterial = new CANNON.Material();
  
  const contactMaterial = new CANNON.ContactMaterial(groundMaterial, sphereMaterial, {
    friction: 0.3,
    restitution: BOUNCE_RESTITUTION,
    contactEquationStiffness: 1e8,    // Increase stiffness for better collision response
    contactEquationRelaxation: 3,     // Relaxation for stability
  });
  
  world.addContactMaterial(contactMaterial);
  groundBody.material = groundMaterial;
  */
  
  groundBody.position.set(0, -8, 0);
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
  const geometry = new THREE.BoxGeometry(width * 2, height * 2, depth * 2);
  ground = new THREE.Mesh(geometry, materials);
  ground.position.copy(groundBody.position);
  ground.receiveShadow = false;
  scene.add(ground);
}

// Create a sphere based on transaction amount
function createSphere(amount, txHash) {
  // Scale the size based on amount (MIN_AMOUNT = smallest, MAX_AMOUNT = largest)
  const logMin = Math.log10(MIN_AMOUNT);
  const logMax = Math.log10(MAX_AMOUNT);
  const logAmount = Math.log10(Math.max(MIN_AMOUNT, Math.min(MAX_AMOUNT, amount)));
  
  // Get basic 0-1 normalization
  const normalizedSize = (logAmount - logMin) / (logMax - logMin);
  
  // Apply cubic power to favor smaller sizes
  // Higher power = more small spheres, fewer large ones
  const weightedSize = Math.pow(normalizedSize, 3);
  
  // Map to final size range (0.4 to 12.4)
  const size = MIN_SPHERE_SIZE + (weightedSize * MAX_SPHERE_SIZE);
  
  // Rest of the createSphere function remains the same...
  // Dynamically less bouncy for large spheres
  const restitution = (Math.log10(size) - Math.log10(MIN_SPHERE_SIZE)) / (Math.log10(MAX_SPHERE_SIZE) - Math.log10(MIN_SPHERE_SIZE));
  const dynamicRestitution = BOUNCE_RESTITUTION * (1 - restitution);

  const sphereShape = new CANNON.Sphere(size);
  const sphereBody = new CANNON.Body({
    mass: Math.pow(size, 3), // sphere volume
    shape: sphereShape,
    material: new CANNON.Material({
      restitution: dynamicRestitution,
    }),
    // linearDamping: 0.01,      // Add slight damping to prevent endless bouncing
    // allowSleep: true,         // Allow bodies to sleep when static
    // collisionResponse: true,  // Ensure collisions are processed
    // sleepSpeedLimit: 5,   // Bodies sleep when moving slower than this
    // sleepTimeLimit: 1.0,      // Bodies must be still for this long before sleeping
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

  // Get normalized value between 0 and 1 based on amount
  let normalizedAmount;
  if (amount === 0) {
    normalizedAmount = 0;
  } else {
    normalizedAmount = (logAmount - logMin) / (logMax - logMin);
  }

  // Calculate segments - scale between min and max segments
  const segmentSize = Math.round(MIN_SPHERE_SEGMENTS + (normalizedAmount * (MAX_SPHERE_SEGMENTS - MIN_SPHERE_SEGMENTS)));
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
  if (spheres.length > MAX_SPHERES) {
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
async function fetchRPC(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  return data.result;
}

async function getLatestBlocksAndTransactions() {
  if (pendingRequest) {
    return null;
  }
  
  try {
    pendingRequest = true;
    
    // First get block number
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: []
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const { result: blockNumberHex } = await response.json();
    const latestBlockNumber = parseInt(blockNumberHex, 16);
    
    // Get all three blocks in one batch call
    // To make sure we don't miss any blocks
    const blocksResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getBlockByNumber',
          params: [`0x${(latestBlockNumber - 3).toString(16)}`, true]
        },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'eth_getBlockByNumber',
          params: [`0x${(latestBlockNumber - 2).toString(16)}`, true]
        },
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'eth_getBlockByNumber',
          params: [`0x${(latestBlockNumber - 1).toString(16)}`, true]
        },
        {
          jsonrpc: '2.0',
          id: 5,
          method: 'eth_getBlockByNumber',
          params: [`0x${latestBlockNumber.toString(16)}`, true]
        }
      ])
    });

    if (!blocksResponse.ok) {
      throw new Error(`HTTP error! status: ${blocksResponse.status}`);
    }

    const blocksData = await blocksResponse.json();
    
    // Process all blocks from the batch response
    const newTransactions = [];
    
    for (const result of blocksData) {
      const block = result.result;
      if (!block) continue;

      // Skip if we've already processed this block
      if (processedBlockHashes.has(block.hash)) {
        continue;
      }

      // console.info(parseInt(block.number, 16));
      processedBlockHashes.add(block.hash);

      // Keep set size manageable
      if (processedBlockHashes.size > 50) {
        const oldestHash = processedBlockHashes.values().next().value;
        processedBlockHashes.delete(oldestHash);
      }

      // Add transactions from this block
      if (block.transactions?.length > 0) {
        newTransactions.push(...block.transactions.map(tx => ({
          hash: tx.hash,
          amount: parseInt(tx.value, 16) / 1e18,
          subtype: tx.to ? 'send' : 'contract_creation',
          blockHash: block.hash,
          blockNumber: parseInt(block.number, 16)
        })));
      }
    }

    return newTransactions.length > 0 ? newTransactions : null;

  } catch (error) {
    console.error('Error fetching blockchain data:', error);
    return null;
  } finally {
    pendingRequest = null;
  }
}

function pollForNewBlocks() {
  let isPolling = true;

  async function poll() {
    if (!isPolling) return;

    const transactions = await getLatestBlocksAndTransactions();
    if (transactions) {
      transactions.forEach(processTransaction);
    }

    setTimeout(poll, 600);
  }

  poll();
  return () => {
    isPolling = false;
  };
}

function processTransaction(txData) {
  // Check if we should ignore this transaction
  if (window.ignoreZeroTransactions && txData.amount <= 0.000000000000000001) {
    return; // Skip this transaction
  }
  
  sonic_sent += txData.amount;
  createSphere(txData.amount, txData.hash);
  
  // Record transaction time
  transactionTimes.push(Date.now());
  
  // Update 3D display
  if (window.updateStatsDisplay) {
    window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphereGlobal);
  }
}

let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  
  // Calculate delta time
  const currentTime = performance.now();
  let deltaTime = currentTime - lastTime;
  lastTime = currentTime;
  
  // Calculate current tilt
  const tiltAngle = calculateTilt(spheres.length);
  
  // Update ground rotation
  if (ground && ground.position.y !== undefined) {
    // Adjust the rotation point to be at the surface center
    const heightOffset = 2; // Half of the ground's height
    
    // Move ground up by height, rotate, then move back down
    ground.position.y = groundBody.position.y + heightOffset;
    ground.rotation.x = tiltAngle;
    ground.position.z = -Math.sin(tiltAngle) * heightOffset;
    ground.position.y -= Math.cos(tiltAngle) * heightOffset;
    
    // Update physics body rotation
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tiltAngle);
  }
  
  /**
  world.defaultContactMaterial.contactEquationStiffness = 1e8;
  world.defaultContactMaterial.contactEquationRelaxation = 3;
  */
  
  // Step physics simulation
  // world.step(FIXED_TIME_STEP, deltaTime, MAX_SUB_STEPS);
  // Lower step size on lower frame rates (120 animates/s will be TIME_STEP)
  world.step(Math.min(TIME_STEP * (deltaTime / 7), MAX_TIME_STEP));
  // Simulation complexity (lower for better performance)
  world.solver.iterations = 5;
  
  // Update sphere positions
  for (let i = 0; i < spheres.length; i++) {
    spheres[i].position.copy(sphereBodies[i].position);
    spheres[i].quaternion.copy(sphereBodies[i].quaternion);
  }
  
  // Remove spheres that have fallen below a certain point
  for (let i = spheres.length - 1; i >= 0; i--) {
    if (spheres[i].position.y < -70) {
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

// Initialize everything
init();
pollForNewBlocks();