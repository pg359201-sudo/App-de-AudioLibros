import React from 'react';

interface AudioPlayerProps {
    audioSrc: string | null;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioSrc }) => {
    if (!audioSrc) {
        return null;
    }

    return (
        <audio controls src={audioSrc} className="w-full" key={audioSrc}>
            Your browser does not support the audio element.
        </audio>
    );
};

export default AudioPlayer;
