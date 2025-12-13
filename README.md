# 🎭 Impostor Game

A multiplayer word game where players try to find the impostor among them. Built with Node.js, Express, and Socket.io.

## 🎮 How to Play

1. **Create or Join a Game**
   - Click "Create Game" to start a new room
   - Click "Join Game" to enter an existing room with a room code

2. **Lobby**
   - Share your room code with friends
   - Host can choose the number of impostors (1-5)
   - Host clicks "Start Game" when ready

3. **Gameplay**
   - Each player receives a word on their device
   - Normal players see the main word
   - Impostor(s) see a related word and a red "IMPOSTOR" badge
   - Players discuss and try to find the impostor
   - Host can start a new round or end the game

## 🚀 Local Development

### Prerequisites
- Node.js (v14 or higher)
- npm

### Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

5. Test with multiple browser windows/tabs to simulate multiple players

## 📦 Deployment to Render

### Step 1: Push to GitHub

1. Create a new repository on GitHub
2. Initialize git in your project folder:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### Step 2: Deploy on Render

1. Go to [Render.com](https://render.com) and sign up/login

2. Click "New +" → "Web Service"

3. Connect your GitHub repository

4. Configure the service:
   - **Name**: `impostor-game` (or any name you prefer)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or any plan you prefer)

5. Click "Create Web Service"

6. Render will automatically:
   - Build your application
   - Deploy it
   - Provide you with a URL (e.g., `https://impostor-game-xyz.onrender.com`)

### Step 3: Access Your Game

- Once deployed, you'll get a public URL
- Share this URL with friends to play together
- The game works on mobile devices too!

## 🛠️ Technical Details

### Tech Stack
- **Backend**: Node.js + Express + Socket.io
- **Frontend**: HTML, CSS, JavaScript
- **Real-time Communication**: Socket.io WebSockets
- **Storage**: In-memory (no database required)

### Features
- ✅ Real-time multiplayer gameplay
- ✅ Room-based game sessions
- ✅ Random impostor selection
- ✅ Random word pair selection from 50+ French word pairs
- ✅ Mobile-responsive design
- ✅ Host controls (start game, new round, end game)
- ✅ Automatic room cleanup when host leaves

### File Structure
```
impostor-game/
├── server.js              # Backend server with Socket.io
├── package.json           # Dependencies
├── README.md              # This file
└── public/
    ├── index.html         # Landing page
    ├── lobby.html         # Waiting room
    ├── game.html          # Word display screen
    ├── style.css          # Styling
    └── client.js          # Client-side utilities
```

## 🎯 Game Rules

- Minimum 2 players required to start
- Number of impostors must be less than total players
- Each round, new impostors are randomly selected
- Each round, a new random word pair is chosen
- Host can start new rounds or end the game at any time

## 📝 Notes

- Rooms are stored in memory and will be lost if the server restarts
- Rooms are automatically cleaned up when the host leaves
- The game uses French word pairs (as specified in the requirements)
- All game logic runs server-side for security

## 🐛 Troubleshooting

**Issue**: Can't connect to the game
- Check that the server is running
- Verify the port is correct (default: 3000)
- Check browser console for errors

**Issue**: Room not found
- Make sure you're using the correct room code (case-sensitive)
- Room codes expire when the host leaves

**Issue**: Game won't start
- Need at least 2 players
- Number of impostors must be less than total players

## 📄 License

ISC

## 🙏 Credits

Built for multiplayer fun with friends!

