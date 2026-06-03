<USER_REQUEST>
okay here it is , read and understand it first

anything your are confused , ask me question , i will answer all of them then after then give you permison to add it in an integrate 

SYSTEM INSTRUCTIONS FOR AI DEVELOPER

Context:
You are assisting in integrating a polished, production-ready React Main Menu UI into a web-based voxel game (working title: "World Searcher").
The aesthetic is "ethereal sci-fi / breath of fresh air" utilizing Tailwind CSS glassmorphism (backdrop-blur), Lucide-React icons, and a vanilla Three.js background scene rendered within a React useEffect.

Your Task:
Review the provided MainMenu.jsx code below. This is currently a standalone component. You need to help integrate it into the wider game architecture by mapping the mock data to our actual game state, and triggering the game engine initialization when the loading screen finishes.

1. Prerequisites

Ensure the target environment has the following dependencies installed:

react & react-dom

three (Vanilla Three.js)

lucide-react (For UI Icons)

Tailwind CSS (Configured and active)

2. Integration Hooks & Architecture Notes

Before modifying the code, note the following architectural decisions that have been strictly bulletproofed:

Memory Management: The Three.js scene uses a ResizeObserver and a recursive scene.traverse() garbage collection block on unmount. Do not remove this cleanup logic, or the game will suffer WebGL Context memory leaks.

Transitions: The transitionState handles the cinematic loading screen. Look at the useEffect on line ~365. Currently, it auto-resets to 'idle' after 4.5 seconds for demo purposes. You will need to replace this setTimeout with the actual game engine mounting logic (e.g., props.onLoadComplete(type)).

Mock Data: At the top of the file, mockInventory, mockHotbar, and mockSaves need to be replaced with actual props or global state (Zustand/Redux) pulled from the game engine.

3. The Source Code (MainMenu.jsx)

import React, { useState, useEffect, useRef } from 'react';
import { Play,
<truncated 35253 bytes>
e="text-white/70 group-hover:text-white" size={24} />
              </button>
            </div>

            {/* TITLE SETTINGS MENU */}
            <div className={`absolute bottom-0 right-0 w-80 flex flex-col transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeMenu === 'settings' ? 'opacity-100 translate-x-0 pointer-events-auto delay-100' : 'opacity-0 translate-x-12 pointer-events-none'}`}>
              <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl p-6 shadow-2xl space-y-8">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                   <h3 className="text-xl font-light tracking-widest text-white">SETTINGS</h3>
                   <Settings className="text-cyan-400" size={20} />
                </div>
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 text-white/70">
                      <Volume2 size={16} />
                      <span className="text-sm tracking-widest font-bold">AUDIO</span>
                    </div>
                    <CustomSlider label="MASTER" defaultValue={80} />
                    <CustomSlider label="MUSIC" defaultValue={100} />
                  </div>
                </div>
              </div>
              <button onClick={() => setActiveMenu('main')} className="group flex items-center self-end mt-4 p-3 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-none">
                <ChevronLeft className="text-white/50 group-hover:text-cyan-400 transition-colors mr-2" size={20} />
                <span className="tracking-widest font-light text-white/50 group-hover:text-white transition-colors">BACK</span>
              </button>
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}

</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-05-30T04:27:42+08:00.
</ADDITIONAL_METADATA>